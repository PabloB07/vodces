import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";

import ffmpegStaticPath from "ffmpeg-static";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EXPORT_TMP_DIR = join(tmpdir(), "vodces-exports");
const MAX_EXPORT_DURATION_SECONDS = 900;
const MAX_BOUNDARY_SECONDS = 43_200;
const FFMPEG_TIMEOUT_MS = 240_000;
const KICK_PLAYLIST_TIMEOUT_MS = 15_000;
const KICK_SEGMENT_TIMEOUT_MS = 20_000;
const MAX_SEGMENTS_DOWNLOAD = 240;
const FFMPEG_BINARY_NAME = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const FFMPEG_CANDIDATE_PATHS = [
  ffmpegStaticPath,
  join(process.cwd(), "node_modules", "ffmpeg-static", FFMPEG_BINARY_NAME),
].filter((value): value is string => typeof value === "string" && value.length > 0);

const SAFE_MEDIA_HOSTS = [
  "kick.com",
  "www.kick.com",
  "clips.kick.com",
  "stream.kick.com",
  "files.kick.com",
  "images.kick.com",
];

type HlsSegment = {
  durationSec: number;
  uri: URL;
};

function isAllowedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (SAFE_MEDIA_HOSTS.includes(host)) {
    return true;
  }

  return host.endsWith(".playback.live-video.net");
}

function sanitizeMediaTarget(rawTarget: string | null): URL | null {
  if (!rawTarget) {
    return null;
  }

  try {
    const target = new URL(rawTarget);
    if (target.protocol !== "https:") {
      return null;
    }

    if (!isAllowedMediaHost(target.hostname)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

function parseSeconds(raw: string | null): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  const rounded = Math.floor(parsed);
  if (rounded > MAX_BOUNDARY_SECONDS) {
    return null;
  }

  return rounded;
}

function sanitizeFileStem(raw: string | null): string {
  if (!raw) {
    return "vod-recorte";
  }

  const normalized = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (!normalized) {
    return "vod-recorte";
  }

  return normalized;
}

function normalizeHlsLines(raw: string): string[] {
  return raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
}

function parseHlsAttributeInt(line: string, key: string): number {
  const match = line.match(new RegExp(`${key}=([0-9]+)`));
  if (!match) {
    return 0;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function resolveFfmpegBinaryPath(): Promise<string | null> {
  for (const candidate of Array.from(new Set(FFMPEG_CANDIDATE_PATHS))) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchText(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/vnd.apple.mpegurl,*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Unable to fetch playlist: ${url.hostname}`);
  }

  if (!response.ok) {
    throw new Error(`Playlist request failed with ${response.status}.`);
  }

  return response.text();
}

async function fetchBinary(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Unable to fetch segment: ${url.hostname}`);
  }

  if (!response.ok) {
    throw new Error(`Segment request failed with ${response.status}.`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function resolveMediaPlaylistUrl(masterPlaylist: string, masterUrl: URL): URL {
  const lines = normalizeHlsLines(masterPlaylist);
  const variants: Array<{ bandwidth: number; url: URL }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }

    const bandwidth = parseHlsAttributeInt(line, "BANDWIDTH");
    const nextLine = lines[index + 1] ?? "";
    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }

    let variantUrl: URL;
    try {
      variantUrl = new URL(nextLine, masterUrl);
    } catch {
      continue;
    }

    if (!isAllowedMediaHost(variantUrl.hostname)) {
      continue;
    }

    variants.push({ bandwidth, url: variantUrl });
  }

  if (variants.length === 0) {
    return masterUrl;
  }

  variants.sort((left, right) => right.bandwidth - left.bandwidth);
  return variants[0].url;
}

function parseMediaSegments(mediaPlaylist: string, mediaUrl: URL): HlsSegment[] {
  const lines = normalizeHlsLines(mediaPlaylist);
  const targetDurationLine = lines.find((line) => line.startsWith("#EXT-X-TARGETDURATION:"));
  const targetDuration = targetDurationLine
    ? Number.parseFloat(targetDurationLine.replace("#EXT-X-TARGETDURATION:", ""))
    : 10;
  const safeTargetDuration = Number.isFinite(targetDuration) && targetDuration > 0
    ? targetDuration
    : 10;

  const segments: HlsSegment[] = [];
  let pendingDuration: number | null = null;

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      const rawDuration = line.slice("#EXTINF:".length).split(",", 1)[0] ?? "";
      const parsed = Number.parseFloat(rawDuration);
      pendingDuration = Number.isFinite(parsed) && parsed > 0 ? parsed : safeTargetDuration;
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    let segmentUrl: URL;
    try {
      segmentUrl = new URL(line, mediaUrl);
    } catch {
      continue;
    }

    if (!isAllowedMediaHost(segmentUrl.hostname)) {
      throw new Error("Unsafe segment host in playlist.");
    }

    const durationSec = pendingDuration ?? safeTargetDuration;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      continue;
    }

    segments.push({ durationSec, uri: segmentUrl });
    pendingDuration = null;
  }

  return segments;
}

function selectSegmentsByWindow(segments: HlsSegment[], startSec: number, endSec: number) {
  let cursor = 0;
  let firstIncludedStart = 0;
  const selected: HlsSegment[] = [];

  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.durationSec;

    if (segmentEnd > startSec && segmentStart < endSec) {
      if (selected.length === 0) {
        firstIncludedStart = segmentStart;
      }

      selected.push(segment);
    }

    cursor = segmentEnd;
    if (segmentStart > endSec) {
      break;
    }
  }

  const trimOffsetSec = Math.max(0, startSec - firstIncludedStart);
  const clipDurationSec = Math.max(1, endSec - startSec);

  return { selected, trimOffsetSec, clipDurationSec };
}

function sanitizeSegmentExtension(pathname: string): string {
  const extension = extname(pathname).toLowerCase();
  if (extension === ".ts") {
    return extension;
  }

  return ".ts";
}

async function writeConcatInputs(
  workDir: string,
  segments: HlsSegment[],
  signal: AbortSignal,
): Promise<string> {
  const concatLines: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const ext = sanitizeSegmentExtension(segment.uri.pathname);
    const segmentPath = join(workDir, `segment-${String(index).padStart(4, "0")}${ext}`);

    const content = await fetchBinary(segment.uri, KICK_SEGMENT_TIMEOUT_MS, signal);
    await writeFile(segmentPath, content);

    const escapedPath = segmentPath.replace(/'/g, "'\\''");
    concatLines.push(`file '${escapedPath}'`);
  }

  const concatPath = join(workDir, "segments.txt");
  await writeFile(concatPath, `${concatLines.join("\n")}\n`, "utf8");
  return concatPath;
}

async function runFfmpegExport(
  ffmpegBinaryPath: string,
  concatPath: string,
  trimOffsetSec: number,
  clipDurationSec: number,
  outputPath: string,
  abortSignal: AbortSignal,
): Promise<void> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-ss",
    trimOffsetSec.toFixed(3),
    "-t",
    clipDurationSec.toFixed(3),
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];

  const child = spawn(ffmpegBinaryPath, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
    if (stderr.length > 6000) {
      stderr = stderr.slice(-6000);
    }
  });

  const timeoutId = setTimeout(() => {
    child.kill("SIGKILL");
  }, FFMPEG_TIMEOUT_MS);

  const abortHandler = () => {
    child.kill("SIGKILL");
  };
  abortSignal.addEventListener("abort", abortHandler, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        reject(error);
      });

      child.once("close", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        const details = stderr.trim().slice(-500);
        if (signal) {
          reject(new Error(`FFmpeg terminated by signal ${signal}.`));
          return;
        }

        reject(new Error(details ? `FFmpeg failed: ${details}` : `FFmpeg failed with code ${code}.`));
      });
    });
  } finally {
    clearTimeout(timeoutId);
    abortSignal.removeEventListener("abort", abortHandler);
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sourceUrl = sanitizeMediaTarget(requestUrl.searchParams.get("u"));
  const startSec = parseSeconds(requestUrl.searchParams.get("start"));
  const endSec = parseSeconds(requestUrl.searchParams.get("end"));

  if (!sourceUrl || startSec === null || endSec === null || endSec <= startSec) {
    return NextResponse.json(
      { error: "Invalid export parameters." },
      { status: 400 },
    );
  }

  const duration = endSec - startSec;
  if (duration > MAX_EXPORT_DURATION_SECONDS) {
    return NextResponse.json(
      {
        error: `Max export duration is ${MAX_EXPORT_DURATION_SECONDS} seconds.`,
      },
      { status: 400 },
    );
  }

  const ffmpegBinaryPath = await resolveFfmpegBinaryPath();
  if (!ffmpegBinaryPath) {
    return NextResponse.json(
      { error: "FFmpeg is not available on this server." },
      { status: 503 },
    );
  }

  await mkdir(EXPORT_TMP_DIR, { recursive: true });

  const fileStem = sanitizeFileStem(requestUrl.searchParams.get("name"));
  const workDir = join(EXPORT_TMP_DIR, randomUUID());
  const outputPath = join(workDir, "export.mp4");
  const downloadName = `${fileStem}-${startSec}-${endSec}.mp4`;

  try {
    await mkdir(workDir, { recursive: true });

    const masterPlaylist = await fetchText(sourceUrl, KICK_PLAYLIST_TIMEOUT_MS, request.signal);
    const mediaPlaylistUrl = resolveMediaPlaylistUrl(masterPlaylist, sourceUrl);
    const mediaPlaylist = mediaPlaylistUrl.toString() === sourceUrl.toString()
      ? masterPlaylist
      : await fetchText(mediaPlaylistUrl, KICK_PLAYLIST_TIMEOUT_MS, request.signal);

    const parsedSegments = parseMediaSegments(mediaPlaylist, mediaPlaylistUrl);
    if (parsedSegments.length === 0) {
      throw new Error("No segments found in playlist.");
    }

    const { selected, trimOffsetSec, clipDurationSec } = selectSegmentsByWindow(parsedSegments, startSec, endSec);
    if (selected.length === 0) {
      throw new Error("Selected range is outside the available VOD window.");
    }
    if (selected.length > MAX_SEGMENTS_DOWNLOAD) {
      throw new Error("Selected range requires too many segments.");
    }

    const concatPath = await writeConcatInputs(workDir, selected, request.signal);

    await runFfmpegExport(
      ffmpegBinaryPath,
      concatPath,
      trimOffsetSec,
      clipDurationSec,
      outputPath,
      request.signal,
    );
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });

    const message = error instanceof Error ? error.message : "FFmpeg export failed.";
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }

  const fileStream = createReadStream(outputPath);
  fileStream.on("close", () => {
    void rm(workDir, { recursive: true, force: true });
  });

  return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "no-store",
    },
  });
}
