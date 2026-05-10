import { NextResponse } from "next/server";

const KICK_PLAYLIST_TIMEOUT_MS = 15_000;
const MAX_EXPORT_DURATION_SECONDS = 43_200;
const MAX_BOUNDARY_SECONDS = 43_200;

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

async function fetchText(url: URL, signal?: AbortSignal): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/vnd.apple.mpegurl,*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(KICK_PLAYLIST_TIMEOUT_MS)])
        : AbortSignal.timeout(KICK_PLAYLIST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Unable to fetch playlist: ${url.hostname}`);
  }

  if (!response.ok) {
    throw new Error(`Playlist request failed with ${response.status}.`);
  }

  return response.text();
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

function selectSegmentsByWindow(
  segments: HlsSegment[],
  startSec: number,
  endSec: number,
): HlsSegment[] {
  let cursor = 0;
  const selected: HlsSegment[] = [];

  for (const segment of segments) {
    const segmentStart = cursor;
    const segmentEnd = cursor + segment.durationSec;

    if (segmentEnd > startSec && segmentStart < endSec) {
      selected.push(segment);
    }

    cursor = segmentEnd;
    if (segmentStart > endSec) {
      break;
    }
  }

  return selected;
}

function buildTrimmedPlaylist(segments: HlsSegment[]): string {
  const targetDuration = Math.max(
    1,
    Math.ceil(
      segments.reduce((max, segment) => Math.max(max, segment.durationSec), 0),
    ),
  );

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];

  for (const segment of segments) {
    lines.push(`#EXTINF:${segment.durationSec.toFixed(3)},`);
    lines.push(segment.uri.toString());
  }

  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
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
      { error: `Max export duration is ${MAX_EXPORT_DURATION_SECONDS} seconds.` },
      { status: 400 },
    );
  }

  try {
    const masterPlaylist = await fetchText(sourceUrl, request.signal);
    const mediaPlaylistUrl = resolveMediaPlaylistUrl(masterPlaylist, sourceUrl);
    const mediaPlaylist = mediaPlaylistUrl.toString() === sourceUrl.toString()
      ? masterPlaylist
      : await fetchText(mediaPlaylistUrl, request.signal);

    const parsedSegments = parseMediaSegments(mediaPlaylist, mediaPlaylistUrl);
    if (parsedSegments.length === 0) {
      throw new Error("No segments found in playlist.");
    }

    const selectedSegments = selectSegmentsByWindow(parsedSegments, startSec, endSec);
    if (selectedSegments.length === 0) {
      throw new Error("Selected range is outside the available VOD window.");
    }

    const body = buildTrimmedPlaylist(selectedSegments);
    const fileStem = sanitizeFileStem(requestUrl.searchParams.get("name"));
    const downloadName = `${fileStem}-${startSec}-${endSec}.m3u8`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "m3u8 export failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
