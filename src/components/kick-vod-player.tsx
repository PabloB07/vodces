"use client";

import Link from "next/link";
import Image from "next/image";
import Hls from "hls.js";
import {
  Download,
  LoaderCircle,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PROGRESS_STORAGE_KEY = "vodces:progress:v1";
const PROGRESS_SAVE_INTERVAL_MS = 60_000;
const STREAMER_REFRESH_INTERVAL_MS = 30_000;
const QUALITY_AUTO = "auto";
const VODS_PAGE_SIZE = 6;
const MOMENTS_PAGE_SIZE = 4;
const DEFAULT_SNAP_STEP_SEC = 1;
const MOAIGR_BANNER_URL =
  "https://files.kick.com/images/channel/12312071/banner_image/d1d7d409-c553-4da1-8519-69fd7bbca85d";
const ThemeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => mod.ThemeToggle),
  { ssr: false },
);

type QualityOption = {
  value: string;
  label: string;
};

type NativeQualityVariant = {
  value: string;
  label: string;
  url: string;
  height: number;
  bandwidth: number;
};

type StreamerInfo = {
  id: number | null;
  slug: string;
  username: string;
  profileImageUrl: string | null;
  bannerImageUrl: string | null;
};

type VodItem = {
  id: number;
  videoUuid: string;
  title: string;
  createdAt: string | null;
  durationMs: number | null;
  views: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
  isLive?: boolean;
  liveSourceUrl?: string | null;
};

type MomentItem = {
  id: string;
  title: string;
  createdAt: string | null;
  durationMs: number | null;
  views: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
  hasDirectClipUrl: boolean;
  playbackUrl: string | null;
  playbackIsM3u8: boolean;
  videoUuid: string | null;
  vodId: number | null;
  offsetMs: number | null;
};

type StreamerResponse = {
  streamer: StreamerInfo | null;
  vods: VodItem[];
  moments: MomentItem[];
  fetchedAt: string;
  errors: string[];
};

type VideoSourceResponse = {
  videoUuid: string;
  sourceUrl: string;
  title: string | null;
  createdAt: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
};

type MomentSortMode = "relevant" | "views" | "recent";

type Props = {
  defaultStreamer: string;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatSeconds(seconds: number): string {
  return formatDuration(seconds * 1000);
}

function roundToStep(value: number, step: number): number {
  if (step <= 1) {
    return value;
  }

  return Math.round(value / step) * step;
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) {
    return "Fecha desconocida";
  }

  return new Intl.DateTimeFormat("es-CL", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoDate));
}

function formatDateTime(isoDate: string | null): string {
  if (!isoDate) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CL", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatViews(views: number | null): string {
  if (views === null) {
    return "Views N/A";
  }

  return `${new Intl.NumberFormat("es-CL").format(views)} views`;
}

function formatBitrateKbps(value: number): string {
  return `${Math.round(value / 1000)} kbps`;
}

function formatQualityLabel(
  level: { height?: number; bitrate?: number },
  index: number,
): string {
  const height =
    typeof level.height === "number" && level.height > 0
      ? `${level.height}p`
      : null;
  const bitrate =
    typeof level.bitrate === "number" && level.bitrate > 0
      ? formatBitrateKbps(level.bitrate)
      : null;

  if (height && bitrate) {
    return `${height} (${bitrate})`;
  }

  if (height) {
    return height;
  }

  if (bitrate) {
    return bitrate;
  }

  return `Nivel ${index + 1}`;
}

function parseNativeHlsVariants(
  manifest: string,
  masterUrl: string,
): NativeQualityVariant[] {
  const lines = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const variants: NativeQualityVariant[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }

    const attrs = line.slice("#EXT-X-STREAM-INF:".length);
    const resolutionMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidthMatch = attrs.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);

    let uri: string | null = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith("#")) {
        continue;
      }
      uri = lines[j];
      break;
    }

    if (!uri) {
      continue;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(uri, masterUrl).toString();
    } catch {
      continue;
    }

    const height = resolutionMatch ? Number(resolutionMatch[2]) : 0;
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
    const label = height > 0 ? `${height}p` : formatBitrateKbps(bandwidth || 0);

    variants.push({
      value: `native-${variants.length}`,
      label,
      url: absoluteUrl,
      height,
      bandwidth,
    });
  }

  const deduped = variants.reduce<Map<string, NativeQualityVariant>>((acc, item) => {
    const key = item.height > 0 ? `h:${item.height}` : `b:${item.bandwidth}`;
    const existing = acc.get(key);
    if (!existing || item.bandwidth > existing.bandwidth) {
      acc.set(key, item);
    }
    return acc;
  }, new Map());

  return [...deduped.values()].sort((a, b) => {
    if (a.height !== b.height) {
      return b.height - a.height;
    }
    return b.bandwidth - a.bandwidth;
  });
}

function readProgressMap(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, number>>(
      (acc, [key, value]) => {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          acc[key] = Math.floor(value);
        }
        return acc;
      },
      {},
    );
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeDurationMs(value: unknown): number | null {
  const numeric = asNumber(value);
  if (!numeric || numeric <= 0) {
    return null;
  }

  return numeric < 86_400 ? Math.floor(numeric * 1_000) : Math.floor(numeric);
}

function normalizeOffsetMs(value: unknown): number | null {
  const numeric = asNumber(value);
  if (numeric === null || numeric < 0) {
    return null;
  }

  if (numeric < 86_400) {
    return Math.floor(numeric * 1_000);
  }

  return Math.floor(numeric);
}

function sanitizeMediaUrl(raw: unknown): string | null {
  const value = asString(raw);
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }

    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function extractMomentVideoUuid(clip: Record<string, unknown>): string | null {
  const video = isRecord(clip.video) ? clip.video : null;
  const livestream = isRecord(clip.livestream) ? clip.livestream : null;
  const livestreamVideo = isRecord(livestream?.video) ? livestream.video : null;

  return (
    asString(clip.video_uuid) ??
    asString(video?.uuid) ??
    asString(livestreamVideo?.uuid) ??
    null
  );
}

function extractMomentVodId(clip: Record<string, unknown>): number | null {
  const livestream = isRecord(clip.livestream) ? clip.livestream : null;

  return (
    asNumber(clip.live_stream_id) ??
    asNumber(clip.livestream_id) ??
    asNumber(livestream?.id) ??
    null
  );
}

function extractMomentOffsetMs(clip: Record<string, unknown>): number | null {
  const keys = [
    "offset_ms",
    "stream_offset_ms",
    "stream_offset",
    "start_offset_ms",
    "start_offset",
    "clip_start_ms",
    "clip_start",
    "vod_offset_ms",
    "vod_offset",
  ];

  for (const key of keys) {
    const value = normalizeOffsetMs(clip[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function normalizeStreamerPayload(
  streamerSlug: string,
  channelRaw: unknown,
  clipsRaw: unknown,
): StreamerResponse | null {
  if (!isRecord(channelRaw)) {
    return null;
  }

  const user = isRecord(channelRaw.user) ? channelRaw.user : null;
  const bannerImage = isRecord(channelRaw.banner_image)
    ? channelRaw.banner_image
    : null;

  const streamer: StreamerInfo = {
    id: asNumber(channelRaw.id),
    slug: streamerSlug,
    username: asString(user?.username) ?? streamerSlug,
    profileImageUrl:
      sanitizeMediaUrl(user?.profile_pic) ?? sanitizeMediaUrl(user?.profilepic),
    bannerImageUrl: sanitizeMediaUrl(bannerImage?.url),
  };

  const previousLivestreams = Array.isArray(channelRaw.previous_livestreams)
    ? channelRaw.previous_livestreams
    : [];

  let vods = previousLivestreams
    .map((rawVod) => {
      if (!isRecord(rawVod)) {
        return null;
      }

      const video = isRecord(rawVod.video) ? rawVod.video : null;
      const videoUuid = asString(video?.uuid);
      const vodId = asNumber(rawVod.id);
      if (!videoUuid || !vodId) {
        return null;
      }

      const thumbnail = isRecord(rawVod.thumbnail)
        ? sanitizeMediaUrl(rawVod.thumbnail.src)
        : sanitizeMediaUrl(rawVod.thumbnail);

      const vodItem: VodItem = {
        id: Math.floor(vodId),
        videoUuid,
        title: asString(rawVod.session_title) ?? `VOD ${vodId}`,
        createdAt: toIsoDate(rawVod.created_at),
        durationMs: normalizeDurationMs(rawVod.duration),
        views: asNumber(rawVod.views) ?? asNumber(rawVod.viewer_count),
        thumbnailUrl: thumbnail,
        kickUrl: `https://kick.com/${encodeURIComponent(streamerSlug)}/videos/${encodeURIComponent(videoUuid)}`,
        isLive: false,
        liveSourceUrl: null,
      };

      return vodItem;
    })
    .filter((vod): vod is VodItem => vod !== null)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt ?? "1970-01-01") -
        Date.parse(a.createdAt ?? "1970-01-01"),
    );

  const livestream = isRecord(channelRaw.livestream) ? channelRaw.livestream : null;
  const playbackUrl = sanitizeMediaUrl(channelRaw.playback_url);

  if (livestream && livestream.is_live === true && playbackUrl) {
    const liveId =
      Math.floor(
        asNumber(livestream.id) ?? 900_000_000 + (asNumber(channelRaw.id) ?? 0),
      );

    const liveThumbnail = isRecord(livestream.thumbnail)
      ? sanitizeMediaUrl(livestream.thumbnail.src) ??
        sanitizeMediaUrl(livestream.thumbnail.url)
      : sanitizeMediaUrl(livestream.thumbnail);

    const liveItem: VodItem = {
      id: liveId,
      videoUuid: `live-${streamerSlug}`,
      title: asString(livestream.session_title) ?? `${streamer.username} en vivo`,
      createdAt: toIsoDate(livestream.created_at) ?? toIsoDate(livestream.start_time),
      durationMs: normalizeDurationMs(livestream.duration),
      views: asNumber(livestream.viewer_count),
      thumbnailUrl: liveThumbnail ?? streamer.profileImageUrl,
      kickUrl: `https://kick.com/${encodeURIComponent(streamerSlug)}`,
      isLive: true,
      liveSourceUrl: playbackUrl,
    };

    vods = [liveItem, ...vods.filter((vod) => vod.id !== liveItem.id)];
  }

  const clipItems = Array.isArray(clipsRaw)
    ? clipsRaw
    : isRecord(clipsRaw) && Array.isArray(clipsRaw.clips)
      ? clipsRaw.clips
      : [];

  const moments: MomentItem[] = clipItems
    .map((clipRaw) => {
      if (!isRecord(clipRaw)) {
        return null;
      }

      const clipId = asString(clipRaw.id) ?? asString(clipRaw.slug);
      if (!clipId) {
        return null;
      }

      const clipSlug = asString(clipRaw.slug);
      const directClipUrl =
        sanitizeMediaUrl(clipRaw.clip_url) ??
        sanitizeMediaUrl(clipRaw.share_url) ??
        sanitizeMediaUrl(clipRaw.url);
      const playbackIsM3u8 =
        directClipUrl !== null && /(?:\.m3u8)(?:$|[?#])/i.test(directClipUrl);
      const clipPageUrl = clipSlug
        ? `https://kick.com/clips/clip/${encodeURIComponent(clipSlug)}`
        : null;
      const resolvedClipUrl = clipPageUrl ?? (
        directClipUrl && !playbackIsM3u8 ? directClipUrl : null
      ) ?? "https://kick.com/clips";

      return {
        id: clipId,
        title:
          asString(clipRaw.title) ??
          asString(clipRaw.description) ??
          asString(clipRaw.session_title) ??
          `Moment ${clipId}`,
        createdAt:
          toIsoDate(clipRaw.created_at) ??
          toIsoDate(clipRaw.started_at) ??
          toIsoDate(clipRaw.createdAt),
        durationMs: normalizeDurationMs(clipRaw.duration),
        views: asNumber(clipRaw.views) ?? asNumber(clipRaw.view_count),
        thumbnailUrl:
          sanitizeMediaUrl(clipRaw.thumbnail) ??
          sanitizeMediaUrl(clipRaw.thumbnail_url) ??
          sanitizeMediaUrl(clipRaw.screenshot),
        kickUrl: resolvedClipUrl,
        hasDirectClipUrl: resolvedClipUrl !== "https://kick.com/clips",
        playbackUrl: directClipUrl,
        playbackIsM3u8,
        videoUuid: extractMomentVideoUuid(clipRaw),
        vodId: extractMomentVodId(clipRaw),
        offsetMs: extractMomentOffsetMs(clipRaw),
      } satisfies MomentItem;
    })
    .filter((moment): moment is MomentItem => moment !== null)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1));

  return {
    streamer,
    vods,
    moments,
    fetchedAt: new Date().toISOString(),
    errors: [],
  };
}

function normalizeVideoSourcePayload(
  videoUuid: string,
  raw: unknown,
): VideoSourceResponse | null {
  if (!isRecord(raw)) {
    return null;
  }

  const sourceUrl = sanitizeMediaUrl(raw.source);
  if (!sourceUrl) {
    return null;
  }

  const livestream = isRecord(raw.livestream) ? raw.livestream : null;
  const channel = isRecord(livestream?.channel) ? livestream.channel : null;
  const channelSlug = asString(channel?.slug);

  return {
    videoUuid,
    sourceUrl,
    title: asString(livestream?.session_title),
    createdAt: toIsoDate(raw.created_at) ?? toIsoDate(livestream?.created_at),
    durationMs: normalizeDurationMs(livestream?.duration),
    thumbnailUrl: sanitizeMediaUrl(livestream?.thumbnail),
    kickUrl: channelSlug
      ? `https://kick.com/${encodeURIComponent(channelSlug)}/videos/${encodeURIComponent(videoUuid)}`
      : `https://kick.com/video/${encodeURIComponent(videoUuid)}`,
  };
}

function buildSelectedSourceFromVod(vod: VodItem): VideoSourceResponse | null {
  if (vod.isLive && vod.liveSourceUrl) {
    return {
      videoUuid: vod.videoUuid,
      sourceUrl: vod.liveSourceUrl,
      title: vod.title,
      createdAt: vod.createdAt,
      durationMs: vod.durationMs,
      thumbnailUrl: vod.thumbnailUrl,
      kickUrl: vod.kickUrl,
    };
  }

  return null;
}

export default function KickVodPlayer({ defaultStreamer }: Props) {
  const streamerSlug = defaultStreamer;

  const [payload, setPayload] = useState<StreamerResponse | null>(null);
  const [selectedVod, setSelectedVod] = useState<VodItem | null>(null);
  const [selectedSource, setSelectedSource] = useState<VideoSourceResponse | null>(
    null,
  );

  const [loadingStreamer, setLoadingStreamer] = useState(true);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([
    { value: QUALITY_AUTO, label: "Auto" },
  ]);
  const [selectedQuality, setSelectedQuality] = useState(QUALITY_AUTO);

  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const [clipStartSec, setClipStartSec] = useState(0);
  const [clipEndSec, setClipEndSec] = useState<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [momentSortMode, setMomentSortMode] = useState<MomentSortMode>("relevant");
  const [minMomentViews, setMinMomentViews] = useState(0);
  const [momentWindowSec, setMomentWindowSec] = useState(30);
  const [vodPage, setVodPage] = useState(1);
  const [momentPage, setMomentPage] = useState(1);

  const progressMapRef = useRef<Record<string, number>>({});
  const selectedVodRef = useRef<VodItem | null>(null);
  const selectedSourceRef = useRef<VideoSourceResponse | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const nativeQualityMapRef = useRef<Record<string, string>>({});
  const selectedQualityRef = useRef(QUALITY_AUTO);

  useEffect(() => {
    progressMapRef.current = progressMap;
  }, [progressMap]);

  useEffect(() => {
    selectedVodRef.current = selectedVod;
  }, [selectedVod]);

  useEffect(() => {
    selectedSourceRef.current = selectedSource;
  }, [selectedSource]);

  useEffect(() => {
    selectedQualityRef.current = selectedQuality;
  }, [selectedQuality]);

  useEffect(() => {
    const storedProgress = readProgressMap();
    setProgressMap(storedProgress);
    progressMapRef.current = storedProgress;
  }, []);

  const setProgress = useCallback((videoUuid: string, progressMs: number) => {
    setProgressMap((previous) => {
      const next = {
        ...previous,
        [videoUuid]: Math.max(0, Math.floor(progressMs)),
      };

      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures.
      }

      return next;
    });
  }, []);

  const applyHlsQuality = useCallback(
    (qualityValue: string, instance?: Hls | null) => {
      const hls = instance ?? hlsRef.current;
      if (!hls) {
        return;
      }

      if (qualityValue === QUALITY_AUTO) {
        hls.currentLevel = -1;
        hls.nextLevel = -1;
        return;
      }

      const parsedIndex = Number(qualityValue);
      if (
        Number.isInteger(parsedIndex) &&
        parsedIndex >= 0 &&
        parsedIndex < hls.levels.length
      ) {
        hls.currentLevel = parsedIndex;
        hls.nextLevel = parsedIndex;
      }
    },
    [],
  );

  const onQualityChange = useCallback(
    (value: string) => {
      setSelectedQuality(value);

      if (hlsRef.current) {
        applyHlsQuality(value, hlsRef.current);
        return;
      }

      const videoElement = videoRef.current;
      const baseSource = selectedSourceRef.current?.sourceUrl;
      if (!videoElement || !baseSource) {
        return;
      }

      const nextSource =
        value === QUALITY_AUTO
          ? baseSource
          : nativeQualityMapRef.current[value] ?? null;
      if (!nextSource) {
        return;
      }

      const resumeTime = videoElement.currentTime;
      const wasPaused = videoElement.paused;
      const isLive = selectedVodRef.current?.isLive === true;

      videoElement.src = nextSource;

      const onLoaded = () => {
        if (!isLive && Number.isFinite(resumeTime) && resumeTime > 0) {
          const maxSeek = Number.isFinite(videoElement.duration)
            ? Math.max(0, videoElement.duration - 1)
            : resumeTime;
          videoElement.currentTime = Math.min(resumeTime, maxSeek);
        }

        if (!wasPaused) {
          videoElement.play().catch(() => {
            // Ignore autoplay rejection.
          });
        }
      };

      videoElement.addEventListener("loadedmetadata", onLoaded, { once: true });
    },
    [applyHlsQuality],
  );

  const getVideoSourceWithFallback = useCallback(
    async (videoUuid: string): Promise<VideoSourceResponse | null> => {
      try {
        const directResponse = await fetch(
          `https://kick.com/api/v1/video/${encodeURIComponent(videoUuid)}`,
          {
            method: "GET",
          },
        );
        if (directResponse.ok) {
          const directPayload = await directResponse.json();
          const directData = normalizeVideoSourcePayload(videoUuid, directPayload);
          if (directData) {
            return directData;
          }
        }
      } catch {
        // Fall back to proxy.
      }

      try {
        const proxyResponse = await fetch(
          `/api/kick/video/${encodeURIComponent(videoUuid)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        if (!proxyResponse.ok) {
          return null;
        }

        const proxyData = (await proxyResponse.json()) as VideoSourceResponse;
        return proxyData;
      } catch {
        return null;
      }
    },
    [],
  );

  const getStreamerDataWithFallback = useCallback(async (): Promise<StreamerResponse | null> => {
    try {
      const [channelResponse, clipsResponse] = await Promise.all([
        fetch(`https://kick.com/api/v1/channels/${encodeURIComponent(streamerSlug)}`, {
          method: "GET",
        }),
        fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(streamerSlug)}/clips`, {
          method: "GET",
        }),
      ]);

      if (!channelResponse.ok) {
        return null;
      }

      const channelPayload = await channelResponse.json();
      const clipsPayload = clipsResponse.ok ? await clipsResponse.json() : [];
      return normalizeStreamerPayload(streamerSlug, channelPayload, clipsPayload);
    } catch {
      // Fall back to proxy.
    }

    try {
      const proxyResponse = await fetch(
        `/api/kick/streamer/${encodeURIComponent(streamerSlug)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!proxyResponse.ok) {
        return null;
      }

      const proxyData = (await proxyResponse.json()) as StreamerResponse;
      return proxyData;
    } catch {
      return null;
    }
  }, [streamerSlug]);

  const fetchVideoSource = useCallback(async (vod: VodItem) => {
    setLoadingVideo(true);
    setErrorMessage(null);
    setSelectedSource(null);

    try {
      const liveSource = buildSelectedSourceFromVod(vod);
      if (liveSource) {
        setSelectedSource(liveSource);
        return;
      }

      const data = await getVideoSourceWithFallback(vod.videoUuid);
      if (!data) {
        setErrorMessage("No se pudo cargar la fuente del VOD seleccionado.");
        return;
      }

      setSelectedSource({
        ...data,
        kickUrl: vod.kickUrl,
      });
    } catch {
      setErrorMessage("Error de red al cargar el VOD.");
    } finally {
      setLoadingVideo(false);
    }
  }, [getVideoSourceWithFallback]);

  const syncSelectionWithData = useCallback(async (data: StreamerResponse) => {
    const currentSelection = selectedVodRef.current;

    if (!currentSelection) {
      const initialVod = data.vods.find((vod) => vod.isLive === true) ?? data.vods[0];
      if (initialVod) {
        setSelectedVod(initialVod);
        await fetchVideoSource(initialVod);
      } else {
        setSelectedVod(null);
        setSelectedSource(null);
      }
      return;
    }

    const updatedSelection = data.vods.find((vod) => {
      if (currentSelection.isLive) {
        return vod.isLive === true;
      }

      return (
        vod.isLive !== true &&
        (vod.videoUuid === currentSelection.videoUuid || vod.id === currentSelection.id)
      );
    });

    if (updatedSelection) {
      setSelectedVod(updatedSelection);
      const liveSource = buildSelectedSourceFromVod(updatedSelection);
      if (liveSource) {
        setSelectedSource(liveSource);
      }
      return;
    }

    if (currentSelection.isLive) {
      const newestVod = data.vods.find((vod) => vod.isLive !== true);
      if (newestVod) {
        setSelectedVod(newestVod);
        await fetchVideoSource(newestVod);
      } else {
        setSelectedVod(null);
        setSelectedSource(null);
      }
      return;
    }

    const fallbackVod = data.vods[0];
    if (fallbackVod) {
      setSelectedVod(fallbackVod);
      await fetchVideoSource(fallbackVod);
    } else {
      setSelectedVod(null);
      setSelectedSource(null);
    }
  }, [fetchVideoSource]);

  const fetchStreamerData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingStreamer(true);
      setErrorMessage(null);
    }

    try {
      const data = await getStreamerDataWithFallback();
      if (!data) {
        if (!silent) {
          setErrorMessage("No se pudo cargar el canal moaigr.");
        }
        return;
      }

      setPayload(data);
      await syncSelectionWithData(data);
    } catch {
      if (!silent) {
        setErrorMessage("Error de red al consultar datos del streamer.");
      }
    } finally {
      if (!silent) {
        setLoadingStreamer(false);
      }
    }
  }, [getStreamerDataWithFallback, syncSelectionWithData]);

  useEffect(() => {
    void fetchStreamerData(false);
  }, [fetchStreamerData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchStreamerData(true);
    }, STREAMER_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchStreamerData]);

  useEffect(() => {
    const videoElement = videoRef.current;
    const source = selectedSource?.sourceUrl;

    if (!videoElement || !source) {
      return;
    }

    let hls: Hls | null = null;
    let cancelled = false;
    setQualityOptions([{ value: QUALITY_AUTO, label: "Auto" }]);
    setSelectedQuality(QUALITY_AUTO);
    selectedQualityRef.current = QUALITY_AUTO;
    hlsRef.current = null;
    nativeQualityMapRef.current = {};

    const canUseNative = videoElement.canPlayType("application/vnd.apple.mpegurl");

    if (canUseNative) {
      videoElement.src = source;
      setQualityOptions([{ value: QUALITY_AUTO, label: "Auto (navegador)" }]);

      void (async () => {
        try {
          const response = await fetch(source, {
            method: "GET",
            cache: "no-store",
          });
          if (!response.ok) {
            return;
          }

          const manifest = await response.text();
          if (!manifest.includes("#EXT-X-STREAM-INF")) {
            return;
          }

          const variants = parseNativeHlsVariants(manifest, source).filter(
            (variant) => sanitizeMediaUrl(variant.url) !== null,
          );
          if (variants.length === 0 || cancelled) {
            return;
          }

          nativeQualityMapRef.current = Object.fromEntries(
            variants.map((variant) => [variant.value, variant.url]),
          );

          setQualityOptions([
            { value: QUALITY_AUTO, label: "Auto" },
            ...variants.map((variant) => ({
              value: variant.value,
              label: variant.label,
            })),
          ]);
        } catch {
          // Keep native auto mode if playlist parsing fails.
        }
      })();
    } else if (Hls.isSupported()) {
      const instance = new Hls({
        enableWorker: true,
      });

      hls = instance;
      hlsRef.current = instance;

      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        const options: QualityOption[] = [{ value: QUALITY_AUTO, label: "Auto" }];

        instance.levels.forEach((level, index) => {
          options.push({
            value: String(index),
            label: formatQualityLabel(level, index),
          });
        });

        setQualityOptions(options);
        applyHlsQuality(selectedQualityRef.current, instance);
      });

      instance.loadSource(source);
      instance.attachMedia(videoElement);
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setErrorMessage("El stream HLS falló durante la reproducción.");
        }
      });
    } else {
      setErrorMessage("Tu navegador no soporta reproducción HLS.");
      return;
    }

    videoElement.play().catch(() => {
      // Autoplay may be blocked.
    });

    return () => {
      cancelled = true;
      if (hls) {
        hls.destroy();
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
      }

      nativeQualityMapRef.current = {};
      videoElement.removeAttribute("src");
      videoElement.load();
    };
  }, [applyHlsQuality, selectedSource?.sourceUrl]);

  useEffect(() => {
    const videoElement = videoRef.current;
    const vod = selectedVod;

    if (!videoElement || !vod || vod.isLive) {
      return;
    }

    const restoreProgress = () => {
      const savedMs = progressMapRef.current[vod.videoUuid] ?? 0;
      if (savedMs <= 0) {
        return;
      }

      const savedSeconds = savedMs / 1000;
      if (
        Number.isFinite(videoElement.duration) &&
        savedSeconds < videoElement.duration - 5
      ) {
        videoElement.currentTime = savedSeconds;
      }
    };

    const persistProgress = () => {
      const progressMs = Math.floor(videoElement.currentTime * 1000);
      if (progressMs > 0) {
        setProgress(vod.videoUuid, progressMs);
      }
    };

    const intervalId = window.setInterval(() => {
      if (!videoElement.paused && !videoElement.ended) {
        persistProgress();
      }
    }, PROGRESS_SAVE_INTERVAL_MS);

    videoElement.addEventListener("loadedmetadata", restoreProgress, { once: true });
    videoElement.addEventListener("pause", persistProgress);
    videoElement.addEventListener("ended", persistProgress);

    return () => {
      window.clearInterval(intervalId);
      videoElement.removeEventListener("pause", persistProgress);
      videoElement.removeEventListener("ended", persistProgress);
    };
  }, [selectedVod, setProgress]);

  const effectiveDurationSeconds = useMemo(() => {
    const durationMs = selectedSource?.durationMs ?? selectedVod?.durationMs ?? null;
    if (!durationMs || durationMs <= 0) {
      return 0;
    }

    return Math.floor(durationMs / 1000);
  }, [selectedSource?.durationMs, selectedVod?.durationMs]);

  useEffect(() => {
    const isEditable = selectedVod && selectedVod.isLive !== true;
    if (!isEditable) {
      setClipStartSec(0);
      setClipEndSec(null);
      setCurrentTimeSec(0);
      setMomentPage(1);
      return;
    }

    const defaultEnd = effectiveDurationSeconds > 0 ? effectiveDurationSeconds : null;
    setClipStartSec(0);
    setClipEndSec(defaultEnd);
    setMomentPage(1);
  }, [effectiveDurationSeconds, selectedVod, selectedVod?.isLive, selectedVod?.videoUuid]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const onTimeUpdate = () => {
      const nowSec = Math.floor(videoElement.currentTime);
      setCurrentTimeSec(nowSec);
    };

    videoElement.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      videoElement.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  const selectVod = useCallback(async (vod: VodItem) => {
    setSelectedVod(vod);
    setMomentPage(1);
    await fetchVideoSource(vod);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [fetchVideoSource]);

  const getVodEditorUrl = useCallback((
    vod: VodItem,
    range?: { startSec?: number; endSec?: number },
  ): string => {
    const params = new URLSearchParams();
    params.set("uuid", vod.videoUuid);

    if (range?.startSec !== undefined && Number.isFinite(range.startSec)) {
      params.set("start", String(Math.max(0, Math.floor(range.startSec))));
    }

    if (range?.endSec !== undefined && Number.isFinite(range.endSec)) {
      params.set("end", String(Math.max(1, Math.floor(range.endSec))));
    }

    return `/vod/edit?${params.toString()}`;
  }, []);

  const onMomentSeek = useCallback((moment: MomentItem) => {
    if (!videoRef.current || moment.offsetMs === null) {
      return;
    }

    const targetSec = Math.floor(moment.offsetMs / 1000);
    videoRef.current.currentTime = targetSec;
    videoRef.current.play().catch(() => {
      // Ignore autoplay rejection.
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const getMomentViewerUrl = useCallback((moment: MomentItem): string | null => {
    if (!moment.playbackUrl) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("src", moment.playbackUrl);
    params.set("title", moment.title);
    return `/moment/view?${params.toString()}`;
  }, []);

  const onMomentWatchHere = useCallback((moment: MomentItem) => {
    if (moment.offsetMs !== null) {
      onMomentSeek(moment);
      return;
    }

    const viewerUrl = getMomentViewerUrl(moment);
    if (viewerUrl) {
      window.location.href = viewerUrl;
    }
  }, [getMomentViewerUrl, onMomentSeek]);

  const onMomentWatchOutsideKick = useCallback((moment: MomentItem) => {
    const viewerUrl = getMomentViewerUrl(moment);
    if (viewerUrl) {
      window.open(viewerUrl, "_blank", "noopener,noreferrer");
    }
  }, [getMomentViewerUrl]);

  const onUseMomentAsSegment = useCallback((moment: MomentItem) => {
    if (moment.offsetMs === null || !selectedVod || selectedVod.isLive === true) {
      return;
    }

    const startSec = Math.floor(moment.offsetMs / 1000);
    const durationFromMoment = Math.max(8, Math.floor((moment.durationMs ?? 20_000) / 1000));
    const maxEnd = Math.max(startSec + 1, effectiveDurationSeconds);

    const nextStart = clampNumber(
      roundToStep(startSec, DEFAULT_SNAP_STEP_SEC),
      0,
      Math.max(0, maxEnd - 1),
    );
    const nextEnd = clampNumber(
      roundToStep(startSec + durationFromMoment, DEFAULT_SNAP_STEP_SEC),
      nextStart + 1,
      maxEnd,
    );

    setClipStartSec(nextStart);
    setClipEndSec(nextEnd);
    const editUrl = getVodEditorUrl(selectedVod, { startSec: nextStart, endSec: nextEnd });
    window.location.href = editUrl;
  }, [effectiveDurationSeconds, getVodEditorUrl, selectedVod]);

  const isLive = payload?.vods.some((vod) => vod.isLive === true) ?? false;
  const vodCount = payload?.vods.filter((vod) => vod.isLive !== true).length ?? 0;
  const clipLengthSec = Math.max(1, (clipEndSec ?? effectiveDurationSeconds) - clipStartSec);
  const clipCenterSec = clipStartSec + Math.floor(clipLengthSec / 2);

  const momentsForSelectedVod = useMemo(() => {
    if (!payload || !selectedVod || selectedVod.isLive) {
      return {
        items: [] as MomentItem[],
        isFallback: false,
        totalCandidates: 0,
      };
    }

    const directMoments = payload.moments.filter((moment) => {
      const byUuid =
        moment.videoUuid !== null &&
        moment.videoUuid === selectedVod.videoUuid;
      const byVodId = moment.vodId !== null && moment.vodId === selectedVod.id;
      return byUuid || byVodId;
    });

    const sourceMoments = directMoments.length > 0 ? directMoments : payload.moments;
    const minViewsFiltered = sourceMoments.filter(
      (moment) => (moment.views ?? 0) >= minMomentViews,
    );

    const preferredOffsetSec = currentTimeSec > 0 ? currentTimeSec : clipCenterSec;
    const scoredMoments = minViewsFiltered.map((moment) => {
      const offsetSec =
        typeof moment.offsetMs === "number"
          ? Math.floor(moment.offsetMs / 1000)
          : null;
      const inCurrentSegment =
        offsetSec !== null && offsetSec >= clipStartSec && offsetSec <= (clipEndSec ?? effectiveDurationSeconds);

      const distance = offsetSec === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(offsetSec - preferredOffsetSec);
      const relevanceScore = Number.isFinite(distance)
        ? Math.max(0, 100 - (distance / Math.max(1, momentWindowSec)) * 100)
        : 0;

      const viewScore = Math.log10((moment.views ?? 0) + 1) * 16;
      const createdAtMs = moment.createdAt ? Date.parse(moment.createdAt) : 0;
      const dayDiff = createdAtMs > 0
        ? Math.max(1, (Date.now() - createdAtMs) / 86_400_000)
        : 365;
      const recencyScore = 18 / Math.log2(dayDiff + 1);

      return {
        ...moment,
        _meta: {
          inCurrentSegment,
          relevanceScore,
          recencyScore,
          viewScore,
        },
      };
    });

    const sorted = [...scoredMoments].sort((a, b) => {
      if (momentSortMode === "views") {
        return (b.views ?? -1) - (a.views ?? -1);
      }

      if (momentSortMode === "recent") {
        return Date.parse(b.createdAt ?? "1970-01-01") - Date.parse(a.createdAt ?? "1970-01-01");
      }

      const aScore =
        (a._meta.inCurrentSegment ? 30 : 0) +
        a._meta.relevanceScore +
        a._meta.viewScore * 0.6 +
        a._meta.recencyScore * 0.4;
      const bScore =
        (b._meta.inCurrentSegment ? 30 : 0) +
        b._meta.relevanceScore +
        b._meta.viewScore * 0.6 +
        b._meta.recencyScore * 0.4;
      return bScore - aScore;
    });

    return {
      items: sorted.map((entry) => ({
        id: entry.id,
        title: entry.title,
        createdAt: entry.createdAt,
        durationMs: entry.durationMs,
        views: entry.views,
        thumbnailUrl: entry.thumbnailUrl,
        kickUrl: entry.kickUrl,
        hasDirectClipUrl: entry.hasDirectClipUrl === true,
        playbackUrl: entry.playbackUrl ?? null,
        playbackIsM3u8: entry.playbackIsM3u8 === true,
        videoUuid: entry.videoUuid,
        vodId: entry.vodId,
        offsetMs: entry.offsetMs,
      })),
      isFallback: directMoments.length === 0 && payload.moments.length > 0,
      totalCandidates: minViewsFiltered.length,
    };
  }, [
    clipCenterSec,
    clipEndSec,
    clipStartSec,
    currentTimeSec,
    effectiveDurationSeconds,
    minMomentViews,
    momentSortMode,
    momentWindowSec,
    payload,
    selectedVod,
  ]);

  const totalVodPages = Math.max(
    1,
    Math.ceil((payload?.vods.length ?? 0) / VODS_PAGE_SIZE),
  );
  const currentVodPage = clampNumber(vodPage, 1, totalVodPages);
  const visibleVods = useMemo(() => {
    if (!payload) {
      return [] as VodItem[];
    }

    const start = (currentVodPage - 1) * VODS_PAGE_SIZE;
    return payload.vods.slice(start, start + VODS_PAGE_SIZE);
  }, [currentVodPage, payload]);

  const totalMomentPages = Math.max(
    1,
    Math.ceil(momentsForSelectedVod.items.length / MOMENTS_PAGE_SIZE),
  );
  const currentMomentPage = clampNumber(momentPage, 1, totalMomentPages);
  const visibleMoments = useMemo(() => {
    const start = (currentMomentPage - 1) * MOMENTS_PAGE_SIZE;
    return momentsForSelectedVod.items.slice(start, start + MOMENTS_PAGE_SIZE);
  }, [currentMomentPage, momentsForSelectedVod.items]);
  const vodDownloadUrl = useMemo(() => {
    if (!selectedVod || selectedVod.isLive === true) {
      return null;
    }

    return sanitizeMediaUrl(selectedSource?.sourceUrl) ?? null;
  }, [selectedSource?.sourceUrl, selectedVod]);
  const vodEditorUrl = useMemo(() => {
    if (!selectedVod || selectedVod.isLive === true) {
      return null;
    }

    return getVodEditorUrl(selectedVod);
  }, [getVodEditorUrl, selectedVod]);
  const bannerImageUrl = MOAIGR_BANNER_URL;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="relative min-h-[220px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl sm:min-h-[280px]">
          <div className="absolute right-4 top-4 z-20">
            <ThemeToggle />
          </div>
          <div className="absolute inset-0">
            {bannerImageUrl ? (
              <>
                <Image
                  src={bannerImageUrl}
                  alt="banner moaigr"
                  fill
                  sizes="100vw"
                  className="object-cover blur-md brightness-50"
                />
                <Image
                  src={bannerImageUrl}
                  alt="banner completo moaigr"
                  fill
                  sizes="100vw"
                  className="object-contain p-2 sm:p-4"
                  priority
                />
              </>
            ) : (
              <div className="h-full w-full bg-[linear-gradient(120deg,#053f2f,#118a65,#0f172a)]" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.72))]" />
          </div>
          <div className="relative z-10 flex flex-col gap-4 p-4 text-white sm:p-6">
            <Badge className="w-fit bg-emerald-500 text-black hover:bg-emerald-500">
              moaigr • VOD Lab
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                Live + VODs de moaigr
              </h1>
              <p className="max-w-3xl text-sm text-white/85 sm:text-base">
                Player de VODs y best moments de moaigr para Kick!
                Usa el boton Ver VOD para ver el clip en el VOD.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="bg-white/90 text-black">
                {vodCount} VODs
              </Badge>
              <Badge
                className={cn(
                  "text-white",
                  isLive ? "bg-red-600 hover:bg-red-600" : "bg-zinc-700 hover:bg-zinc-700",
                )}
              >
                {isLive ? "LIVE activo" : "Sin live"}
              </Badge>
            </div>
          </div>
        </header>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {selectedVod && selectedSource?.sourceUrl && (
          <Card className="border-emerald-300/70 bg-card/95 shadow-lg">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="line-clamp-2">{selectedVod.title}</CardTitle>
                </div>
                <div className="w-full max-w-52">
                  <Select
                    value={selectedQuality}
                    onValueChange={onQualityChange}
                    disabled={qualityOptions.length <= 1}
                  >
                    <SelectTrigger className="h-9 bg-background">
                      <SelectValue placeholder="Calidad" />
                    </SelectTrigger>
                    <SelectContent>
                      {qualityOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <video
                ref={videoRef}
                controls
                playsInline
                poster={selectedVod.thumbnailUrl ?? undefined}
                className="h-auto w-full rounded-lg bg-black"
              />
              <div className="flex flex-wrap gap-2">
                {selectedVod.isLive && (
                  <Badge className="bg-red-600 text-white hover:bg-red-600">LIVE</Badge>
                )}
                <Badge variant="outline">{formatViews(selectedVod.views)}</Badge>
                <Button asChild variant="secondary" size="sm" className="ml-auto">
                  <a href={selectedVod.kickUrl} target="_blank" rel="noopener noreferrer">
                    Ver en Kick
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {selectedVod && (
          <section className="space-y-3">
            <Card className="border-border/70 bg-card/95">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Descargar VOD</CardTitle>
                <CardDescription>
                  {selectedVod.isLive
                    ? "La descarga directa se habilita cuando el stream termina y queda como VOD."
                    : "Descarga la fuente del VOD actual en formato m3u8."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {vodDownloadUrl ? (
                  <Button asChild>
                    <a
                      href={vodDownloadUrl}
                      download={`${selectedVod.videoUuid}.m3u8`}
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Descargar VOD
                    </a>
                  </Button>
                ) : (
                  <Button disabled>
                    <Download className="mr-1 h-4 w-4" />
                    Descargar VOD
                  </Button>
                )}
                {vodEditorUrl ? (
                  <Button asChild variant="secondary">
                    <Link href={vodEditorUrl}>Editar VOD</Link>
                  </Button>
                ) : (
                  <Button variant="secondary" disabled>
                    Editar VOD
                  </Button>
                )}
                {vodDownloadUrl && (
                  <p className="text-xs text-muted-foreground">
                    Se descargará el archivo playlist m3u8 del VOD.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {!loadingStreamer && (!selectedVod || !selectedSource?.sourceUrl) && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Selecciona un VOD para comenzar.
            </CardContent>
          </Card>
        )}

        {loadingStreamer && !payload && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Cargando VODs de moaigr...
            </CardContent>
          </Card>
        )}

        {!loadingStreamer && payload && (
          <section className="order-[20] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Live + VODs recientes</h2>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{payload.vods.length}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVodPage(Math.max(1, currentVodPage - 1))}
                  disabled={currentVodPage <= 1}
                >
                  Anterior
                </Button>
                <Badge variant="outline">
                  {currentVodPage}/{totalVodPages}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVodPage(Math.min(totalVodPages, currentVodPage + 1))}
                  disabled={currentVodPage >= totalVodPages}
                >
                  Siguiente
                </Button>
              </div>
            </div>
            {payload.vods.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No hay VODs disponibles por ahora.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleVods.map((vod) => {
                  const vodIsLive = vod.isLive === true;

                  return (
                    <Card
                      key={`${vod.id}-${vod.videoUuid}`}
                      className={cn(
                        "overflow-hidden border-border/70 bg-card/90 transition-all hover:-translate-y-0.5 hover:shadow-lg",
                        selectedVod?.id === vod.id && "border-emerald-500 ring-2 ring-emerald-400/40",
                      )}
                    >
                      <div className="relative aspect-video w-full bg-muted">
                        {vod.thumbnailUrl ? (
                          <Image
                            src={vod.thumbnailUrl}
                            alt={vod.title}
                            fill
                            sizes="(max-width: 1024px) 100vw, 33vw"
                            className="object-cover"
                          />
                        ) : null}
                        {vodIsLive && (
                          <Badge className="absolute left-3 top-3 bg-red-600 text-white hover:bg-red-600">
                            LIVE
                          </Badge>
                        )}
                      </div>
                      <CardHeader className="space-y-2 pb-2">
                        <CardTitle className="line-clamp-2 text-base">{vod.title}</CardTitle>
                        <CardDescription>
                          {vodIsLive ? "En vivo" : formatDate(vod.createdAt)}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{formatViews(vod.views)}</Badge>
                          <Badge variant="outline">
                            {vodIsLive ? "LIVE" : formatDuration(vod.durationMs)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            onClick={() => {
                              void selectVod(vod);
                            }}
                            disabled={loadingVideo}
                          >
                            {loadingVideo && selectedVod?.id === vod.id ? (
                              <>
                                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                Cargando...
                              </>
                            ) : vodIsLive ? (
                              "Ver LIVE"
                            ) : (
                              "Ver VOD"
                            )}
                          </Button>
                          <Button asChild variant="secondary">
                            <a href={vod.kickUrl} target="_blank" rel="noopener noreferrer">
                              Abrir en Kick
                            </a>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {selectedVod && selectedVod.isLive !== true && selectedSource && (
            <section className="order-[30] space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-semibold">
                    <TrendingUp className="h-4 w-4" />
                    Mejores momentos del VOD
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {momentsForSelectedVod.isFallback
                      ? "No se detectaron clips directos del VOD; mostrando top del canal."
                      : "Clips vinculados al VOD actual."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{momentsForSelectedVod.totalCandidates}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMomentPage(Math.max(1, currentMomentPage - 1))}
                    disabled={currentMomentPage <= 1}
                  >
                    Anterior
                  </Button>
                  <Badge variant="outline">
                    {currentMomentPage}/{totalMomentPages}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMomentPage(Math.min(totalMomentPages, currentMomentPage + 1))
                    }
                    disabled={currentMomentPage >= totalMomentPages}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <Select
                  value={momentSortMode}
                  onValueChange={(value) => {
                    if (
                      value === "relevant" ||
                      value === "views" ||
                      value === "recent"
                    ) {
                      setMomentPage(1);
                      setMomentSortMode(value);
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Ordenar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevant">Más relevantes</SelectItem>
                    <SelectItem value="views">Más vistos</SelectItem>
                    <SelectItem value="recent">Más recientes</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={0}
                  value={minMomentViews}
                  onChange={(event) => {
                    const parsed = Math.floor(Number(event.target.value));
                    if (Number.isFinite(parsed) && parsed >= 0) {
                      setMomentPage(1);
                      setMinMomentViews(parsed);
                    }
                  }}
                  className="h-8 text-xs"
                  placeholder="Views mínimas"
                />
                <Select
                  value={String(momentWindowSec)}
                  onValueChange={(value) => {
                    const parsed = Number(value);
                    if (Number.isInteger(parsed) && parsed > 0) {
                      setMomentPage(1);
                      setMomentWindowSec(parsed);
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Ventana" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">Ventana 15s</SelectItem>
                    <SelectItem value="30">Ventana 30s</SelectItem>
                    <SelectItem value="60">Ventana 60s</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMomentPage(1);
                    void fetchStreamerData(true);
                  }}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                  Refrescar
                </Button>
              </div>

              {momentsForSelectedVod.items.length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    No se encontraron momentos para este VOD.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleMoments.map((moment) => {
                    const isInsideSegment =
                      moment.offsetMs !== null &&
                      moment.offsetMs / 1000 >= clipStartSec &&
                      moment.offsetMs / 1000 <= (clipEndSec ?? effectiveDurationSeconds);

                    return (
                      <Card
                        key={moment.id}
                        className={cn(
                          "overflow-hidden border-border/70 bg-card/90",
                          isInsideSegment && "border-emerald-400/70 ring-1 ring-emerald-400/40",
                        )}
                      >
                        <div className="relative aspect-video w-full bg-muted">
                          {moment.thumbnailUrl ? (
                            <Image
                              src={moment.thumbnailUrl}
                              alt={moment.title}
                              fill
                              sizes="(max-width: 1024px) 100vw, 33vw"
                              className="object-cover"
                            />
                          ) : null}
                          <Badge className="absolute right-3 top-3 bg-black/75 text-white hover:bg-black/75">
                            {formatDuration(moment.durationMs)}
                          </Badge>
                        </div>
                        <CardHeader className="space-y-2 pb-2">
                          <CardTitle className="line-clamp-2 text-base">{moment.title}</CardTitle>
                          <CardDescription>
                            {formatDateTime(moment.createdAt)} • {formatViews(moment.views)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-[11px] text-muted-foreground">
                            {moment.offsetMs !== null
                              ? `Offset: ${formatSeconds(Math.floor(moment.offsetMs / 1000))}`
                              : "Offset no disponible"}
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={moment.offsetMs === null && !moment.playbackUrl}
                              onClick={() => onMomentWatchHere(moment)}
                            >
                              {moment.offsetMs !== null ? "Ver aquí" : "Reproducir"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={moment.offsetMs === null}
                              onClick={() => onUseMomentAsSegment(moment)}
                            >
                              Recorte
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!moment.playbackUrl}
                              onClick={() => onMomentWatchOutsideKick(moment)}
                            >
                              Fuera Kick
                            </Button>
                          </div>
                          {!moment.playbackUrl && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                              Clip sin URL de reproduccion publica. Usa Ver aquí con el VOD.
                            </p>
                          )}
                          {moment.playbackUrl && moment.playbackIsM3u8 && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400">
                              Se reproduce en este sitio sin descargar archivo.
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
        )}
      </div>
    </main>
  );
}
