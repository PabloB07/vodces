import "server-only";

const KICK_ORIGIN = "https://kick.com";
const KICK_API_V1_BASE = `${KICK_ORIGIN}/api/v1`;
const KICK_API_V2_BASE = `${KICK_ORIGIN}/api/v2`;
const JINA_PROXY_BASE = "https://r.jina.ai/http://kick.com";
const STREAMER_SLUG_PATTERN = /^[a-z0-9_]{3,25}$/;
const VIDEO_UUID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const KICK_CACHE_SECONDS = 120;
const KICK_TIMEOUT_MS = 8_000;
const MAX_VODS = 24;
const MAX_MOMENTS = 12;

const SAFE_KICK_HOSTS = new Set([
  "kick.com",
  "www.kick.com",
  "files.kick.com",
  "images.kick.com",
  "clips.kick.com",
  "stream.kick.com",
]);

export const STREAMER_SLUG = "moaigr";

export type KickStreamerProfile = {
  id: number | null;
  slug: string;
  username: string;
  profileImageUrl: string | null;
  bannerImageUrl: string | null;
};

export type KickVodItem = {
  id: number;
  videoUuid: string;
  title: string;
  createdAt: string | null;
  durationMs: number | null;
  views: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
  isLive: boolean;
  liveSourceUrl: string | null;
};

export type KickMomentItem = {
  id: string;
  title: string;
  createdAt: string | null;
  durationMs: number | null;
  views: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
};

export type KickStreamerData = {
  streamer: KickStreamerProfile | null;
  vods: KickVodItem[];
  moments: KickMomentItem[];
  fetchedAt: string;
  errors: string[];
};

export type KickVideoSource = {
  videoUuid: string;
  sourceUrl: string | null;
  title: string | null;
  createdAt: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
};

type UnknownRecord = Record<string, unknown>;

type FetchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[,_\s]/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function asInt(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric === null) {
    return null;
  }

  return Math.floor(numeric);
}

function clampText(value: string, maxLen = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }

  return `${normalized.slice(0, maxLen - 1)}…`;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeDurationMs(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric === null) {
    return null;
  }

  if (numeric <= 0) {
    return null;
  }

  // Kick v1 VOD duration is in ms; clip payloads are often in seconds.
  if (numeric < 86_400) {
    return Math.floor(numeric * 1_000);
  }

  return Math.floor(numeric);
}

function sanitizeKickUrl(raw: unknown): string | null {
  const value = asString(raw);
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return null;
    }

    const safeHost = [...SAFE_KICK_HOSTS].some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    );
    if (!safeHost) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeStreamerSlug(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!STREAMER_SLUG_PATTERN.test(normalized)) {
    throw new Error("Invalid streamer slug format.");
  }

  return normalized;
}

export function sanitizeVideoUuid(raw: string): string {
  const normalized = raw.trim();
  if (!VIDEO_UUID_PATTERN.test(normalized)) {
    throw new Error("Invalid video UUID format.");
  }

  return normalized;
}

function buildKickApiUrl(version: "v1" | "v2", path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Unsafe endpoint path.");
  }

  const base = version === "v1" ? KICK_API_V1_BASE : KICK_API_V2_BASE;
  const prefix = version === "v1" ? "/api/v1/" : "/api/v2/";

  const url = new URL(`${base}${path}`);
  if (url.origin !== KICK_ORIGIN || !url.pathname.startsWith(prefix)) {
    throw new Error("Unsafe endpoint origin.");
  }

  return url.toString();
}

function buildJinaProxyUrl(version: "v1" | "v2", path: string): string {
  const kickApiUrl = buildKickApiUrl(version, path);
  const sourcePath = kickApiUrl.replace(/^https?:\/\/kick\.com/i, "");
  return `${JINA_PROXY_BASE}${sourcePath}`;
}

function parseJinaMarkdownJson(rawBody: string): unknown | null {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }

  const marker = "Markdown Content:";
  const markerIndex = trimmed.indexOf(marker);
  const content = markerIndex >= 0
    ? trimmed.slice(markerIndex + marker.length).trim()
    : trimmed;

  const objectStart = content.indexOf("{");
  const arrayStart = content.indexOf("[");
  let start = -1;
  if (objectStart >= 0 && arrayStart >= 0) {
    start = Math.min(objectStart, arrayStart);
  } else {
    start = Math.max(objectStart, arrayStart);
  }

  if (start < 0) {
    return null;
  }

  const objectEnd = content.lastIndexOf("}");
  const arrayEnd = content.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  if (end < start) {
    return null;
  }

  const jsonPayload = content.slice(start, end + 1);
  try {
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

async function fetchKickJsonViaJina(
  version: "v1" | "v2",
  path: string,
): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(buildJinaProxyUrl(version, path), {
      method: "GET",
      headers: {
        Accept: "text/plain",
      },
      next: {
        revalidate: KICK_CACHE_SECONDS,
      },
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      error: `Jina fallback network failure on ${path}.`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Jina fallback HTTP ${response.status} on ${path}.`,
    };
  }

  try {
    const body = await response.text();
    const parsed = parseJinaMarkdownJson(body);
    if (parsed === null) {
      return {
        ok: false,
        error: `Jina fallback invalid payload on ${path}.`,
      };
    }

    return {
      ok: true,
      data: parsed,
    };
  } catch {
    return {
      ok: false,
      error: `Jina fallback unreadable payload on ${path}.`,
    };
  }
}

async function fetchKickJson(version: "v1" | "v2", path: string): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch(buildKickApiUrl(version, path), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "vodces/1.0 (+https://kick.com/moaigr)",
      },
      next: {
        revalidate: KICK_CACHE_SECONDS,
      },
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
  } catch {
    return fetchKickJsonViaJina(version, path);
  }

  if (!response.ok) {
    const fallback = await fetchKickJsonViaJina(version, path);
    if (fallback.ok) {
      return fallback;
    }

    return {
      ok: false,
      error: `HTTP ${response.status} on ${path}. ${fallback.error}`,
    };
  }

  try {
    return {
      ok: true,
      data: await response.json(),
    };
  } catch {
    return {
      ok: false,
      error: `Invalid JSON on ${path}.`,
    };
  }
}

function byNewest(a: { createdAt: string | null }, b: { createdAt: string | null }): number {
  const aDate = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bDate = b.createdAt ? Date.parse(b.createdAt) : 0;
  return bDate - aDate;
}

function byViewsThenDate(a: KickMomentItem, b: KickMomentItem): number {
  const viewDelta = (b.views ?? -1) - (a.views ?? -1);
  if (viewDelta !== 0) {
    return viewDelta;
  }

  return byNewest(a, b);
}

function normalizeStreamer(payload: UnknownRecord, slug: string): KickStreamerProfile {
  const user = isRecord(payload.user) ? payload.user : null;
  const banner = isRecord(payload.banner_image) ? payload.banner_image : null;

  return {
    id: asInt(payload.id),
    slug,
    username: asString(user?.username) ?? slug,
    profileImageUrl:
      sanitizeKickUrl(user?.profile_pic) ?? sanitizeKickUrl(user?.profilepic),
    bannerImageUrl: sanitizeKickUrl(banner?.url),
  };
}

function normalizeVod(payload: unknown, channelSlug: string): KickVodItem | null {
  if (!isRecord(payload)) {
    return null;
  }

  const vodId = asInt(payload.id);
  const video = isRecord(payload.video) ? payload.video : null;
  const videoUuid = asString(video?.uuid);

  if (!vodId || !videoUuid) {
    return null;
  }

  const thumbnail = isRecord(payload.thumbnail)
    ? sanitizeKickUrl(payload.thumbnail.src)
      ?? sanitizeKickUrl(payload.thumbnail.url)
    : sanitizeKickUrl(payload.thumbnail);

  return {
    id: vodId,
    videoUuid,
    title: clampText(asString(payload.session_title) ?? `VOD ${vodId}`),
    createdAt: toIsoDate(payload.created_at),
    durationMs: normalizeDurationMs(payload.duration),
    views: asInt(payload.views) ?? asInt(payload.viewer_count),
    thumbnailUrl: thumbnail,
    kickUrl: `${KICK_ORIGIN}/${encodeURIComponent(channelSlug)}/videos/${encodeURIComponent(videoUuid)}`,
    isLive: false,
    liveSourceUrl: null,
  };
}

function normalizeLiveVod(
  channelPayload: UnknownRecord,
  profile: KickStreamerProfile,
): KickVodItem | null {
  const livestream = isRecord(channelPayload.livestream) ? channelPayload.livestream : null;
  const playbackUrl = sanitizeKickUrl(channelPayload.playback_url);
  if (!livestream || livestream.is_live !== true || !playbackUrl) {
    return null;
  }

  const liveId =
    asInt(livestream.id) ?? 900_000_000 + (asInt(channelPayload.id) ?? 0);

  const liveThumbnail = isRecord(livestream.thumbnail)
    ? sanitizeKickUrl(livestream.thumbnail.src) ??
      sanitizeKickUrl(livestream.thumbnail.url)
    : sanitizeKickUrl(livestream.thumbnail);

  return {
    id: liveId,
    videoUuid: `live-${profile.slug}`,
    title:
      clampText(asString(livestream.session_title) ?? `${profile.username} en vivo`),
    createdAt: toIsoDate(livestream.created_at) ?? toIsoDate(livestream.start_time),
    durationMs: normalizeDurationMs(livestream.duration),
    views: asInt(livestream.viewer_count),
    thumbnailUrl: liveThumbnail ?? profile.profileImageUrl,
    kickUrl: `${KICK_ORIGIN}/${encodeURIComponent(profile.slug)}`,
    isLive: true,
    liveSourceUrl: playbackUrl,
  };
}

function normalizeMoment(payload: unknown): KickMomentItem | null {
  if (!isRecord(payload)) {
    return null;
  }

  const id = asString(payload.id) ?? asString(payload.slug);
  if (!id) {
    return null;
  }

  const clipSlug = asString(payload.slug);

  const thumbnail =
    sanitizeKickUrl(payload.thumbnail) ??
    sanitizeKickUrl(payload.thumbnail_url) ??
    sanitizeKickUrl(payload.screenshot);

  return {
    id,
    title: clampText(
      asString(payload.title) ??
        asString(payload.description) ??
        asString(payload.session_title) ??
        `Moment ${id}`,
    ),
    createdAt:
      toIsoDate(payload.created_at) ??
      toIsoDate(payload.started_at) ??
      toIsoDate(payload.createdAt),
    durationMs: normalizeDurationMs(payload.duration),
    views: asInt(payload.views) ?? asInt(payload.view_count),
    thumbnailUrl: thumbnail,
    kickUrl: clipSlug
      ? `${KICK_ORIGIN}/clips/clip/${encodeURIComponent(clipSlug)}`
      : `${KICK_ORIGIN}/clips`,
  };
}

function normalizeVideoSource(payload: unknown, videoUuid: string): KickVideoSource {
  const data = isRecord(payload) ? payload : {};
  const livestream = isRecord(data.livestream) ? data.livestream : null;
  const channel = isRecord(livestream?.channel) ? livestream.channel : null;
  const channelSlug = asString(channel?.slug);

  return {
    videoUuid,
    sourceUrl: sanitizeKickUrl(data.source),
    title: asString(livestream?.session_title),
    createdAt: toIsoDate(data.created_at) ?? toIsoDate(livestream?.created_at),
    durationMs: normalizeDurationMs(livestream?.duration),
    thumbnailUrl: sanitizeKickUrl(livestream?.thumbnail),
    kickUrl: channelSlug
      ? `${KICK_ORIGIN}/${encodeURIComponent(channelSlug)}/videos/${encodeURIComponent(videoUuid)}`
      : `${KICK_ORIGIN}/video/${encodeURIComponent(videoUuid)}`,
  };
}

function extractArray(payload: unknown, key: string): unknown[] {
  if (!isRecord(payload)) {
    return [];
  }

  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

export async function getKickStreamerData(streamerSlug = STREAMER_SLUG): Promise<KickStreamerData> {
  const slug = sanitizeStreamerSlug(streamerSlug);
  const errors: string[] = [];

  const [channelResult, clipsResult] = await Promise.all([
    fetchKickJson("v1", `/channels/${slug}`),
    fetchKickJson("v2", `/channels/${slug}/clips`),
  ]);

  let streamer: KickStreamerProfile | null = null;
  let vods: KickVodItem[] = [];

  if (channelResult.ok && isRecord(channelResult.data)) {
    streamer = normalizeStreamer(channelResult.data, slug);
    vods = extractArray(channelResult.data, "previous_livestreams")
      .map((vod) => normalizeVod(vod, slug))
      .filter((vod): vod is KickVodItem => vod !== null)
      .sort(byNewest);

    const liveVod = normalizeLiveVod(channelResult.data, streamer);
    if (liveVod) {
      vods = [liveVod, ...vods.filter((vod) => vod.id !== liveVod.id)];
    }

    vods = vods.slice(0, MAX_VODS);
  } else if (!channelResult.ok) {
    errors.push(channelResult.error);
  }

  let moments: KickMomentItem[] = [];
  if (clipsResult.ok) {
    const rawClips = Array.isArray(clipsResult.data)
      ? clipsResult.data
      : extractArray(clipsResult.data, "clips");

    moments = rawClips
      .map((clip) => normalizeMoment(clip))
      .filter((clip): clip is KickMomentItem => clip !== null)
      .sort(byViewsThenDate)
      .slice(0, MAX_MOMENTS);
  } else {
    errors.push(clipsResult.error);
  }

  return {
    streamer,
    vods,
    moments,
    fetchedAt: new Date().toISOString(),
    errors,
  };
}

export async function getKickVideoSource(videoUuidRaw: string): Promise<KickVideoSource> {
  const videoUuid = sanitizeVideoUuid(videoUuidRaw);
  const result = await fetchKickJson("v1", `/video/${videoUuid}`);

  if (!result.ok) {
    return {
      videoUuid,
      sourceUrl: null,
      title: null,
      createdAt: null,
      durationMs: null,
      thumbnailUrl: null,
      kickUrl: `${KICK_ORIGIN}/video/${encodeURIComponent(videoUuid)}`,
    };
  }

  return normalizeVideoSource(result.data, videoUuid);
}
