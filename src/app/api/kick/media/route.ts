import { NextResponse } from "next/server";

const KICK_MEDIA_TIMEOUT_MS = 15_000;
const KICK_MEDIA_PATH = "/api/kick/media";

const SAFE_MEDIA_HOSTS = [
  "kick.com",
  "www.kick.com",
  "clips.kick.com",
  "stream.kick.com",
  "files.kick.com",
  "images.kick.com",
];

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

function toProxyUrl(target: URL): string {
  return `${KICK_MEDIA_PATH}?u=${encodeURIComponent(target.toString())}`;
}

function rewritePlaylistLine(line: string, baseUrl: URL): string {
  if (line.length === 0) {
    return line;
  }

  if (!line.startsWith("#")) {
    try {
      const absolute = new URL(line, baseUrl);
      if (!isAllowedMediaHost(absolute.hostname)) {
        return line;
      }

      return toProxyUrl(absolute);
    } catch {
      return line;
    }
  }

  if (!line.includes('URI="')) {
    return line;
  }

  return line.replace(/URI="([^"]+)"/g, (_match, uriValue: string) => {
    try {
      const absolute = new URL(uriValue, baseUrl);
      if (!isAllowedMediaHost(absolute.hostname)) {
        return `URI="${uriValue}"`;
      }
      return `URI="${toProxyUrl(absolute)}"`;
    } catch {
      return `URI="${uriValue}"`;
    }
  });
}

function rewritePlaylist(rawPlaylist: string, sourceUrl: URL): string {
  const normalized = rawPlaylist.replace(/\r\n/g, "\n");
  return normalized
    .split("\n")
    .map((line) => rewritePlaylistLine(line.trim(), sourceUrl))
    .join("\n");
}

function getSafeHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  const contentType = upstream.get("content-type");
  const cacheControl = upstream.get("cache-control");
  const acceptRanges = upstream.get("accept-ranges");
  const contentRange = upstream.get("content-range");
  const contentLength = upstream.get("content-length");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (cacheControl) {
    headers.set("Cache-Control", cacheControl);
  } else {
    headers.set("Cache-Control", "public, max-age=60");
  }
  if (acceptRanges) {
    headers.set("Accept-Ranges", acceptRanges);
  }
  if (contentRange) {
    headers.set("Content-Range", contentRange);
  }
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return headers;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = sanitizeMediaTarget(requestUrl.searchParams.get("u"));
  if (!targetUrl) {
    return NextResponse.json(
      { error: "Invalid media target." },
      { status: 400 },
    );
  }

  const forwardHeaders = new Headers();
  forwardHeaders.set("Accept", "*/*");
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    forwardHeaders.set("Range", rangeHeader);
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "GET",
      headers: forwardHeaders,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(KICK_MEDIA_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream media request failed." },
      { status: 502 },
    );
  }

  const headers = getSafeHeaders(upstream.headers);
  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  const isManifest =
    targetUrl.pathname.toLowerCase().endsWith(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("vnd.apple.mpegurl");

  if (!upstream.ok) {
    const body = isManifest ? await upstream.text() : await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers,
    });
  }

  if (isManifest) {
    const rawPlaylist = await upstream.text();
    const rewritten = rewritePlaylist(rawPlaylist, targetUrl);
    headers.set("Content-Type", "application/vnd.apple.mpegurl");
    headers.delete("Content-Length");
    return new Response(rewritten, {
      status: upstream.status,
      headers,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

