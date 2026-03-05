"use client";

import Hls from "hls.js";
import { LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUALITY_AUTO = "auto";

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

type VodClipPreviewProps = {
  sourceUrl: string;
  posterUrl: string | null;
  clipStartSec: number;
  clipEndSec: number;
};

function toProxyMediaUrl(sourceUrl: string): string {
  const params = new URLSearchParams();
  params.set("u", sourceUrl);
  return `/api/kick/media?${params.toString()}`;
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }

    const attrs = line.slice("#EXT-X-STREAM-INF:".length);
    const resolutionMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidthMatch = attrs.match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i);

    let uri: string | null = null;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (lines[nextIndex].startsWith("#")) {
        continue;
      }

      uri = lines[nextIndex];
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

    variants.push({
      value: `native-${variants.length}`,
      label: height > 0 ? `${height}p` : formatBitrateKbps(bandwidth || 0),
      url: absoluteUrl,
      height,
      bandwidth,
    });
  }

  return variants.sort((left, right) => {
    if (left.height !== right.height) {
      return right.height - left.height;
    }

    return right.bandwidth - left.bandwidth;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function VodClipPreview({
  sourceUrl,
  posterUrl,
  clipStartSec,
  clipEndSec,
}: VodClipPreviewProps) {
  const playbackUrl = useMemo(() => toProxyMediaUrl(sourceUrl), [sourceUrl]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([
    { value: QUALITY_AUTO, label: "Auto" },
  ]);
  const [selectedQuality, setSelectedQuality] = useState(QUALITY_AUTO);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const nativeMapRef = useRef<Record<string, string>>({});
  const clipStartRef = useRef(clipStartSec);
  const clipEndRef = useRef(clipEndSec);

  useEffect(() => {
    clipStartRef.current = clipStartSec;
    clipEndRef.current = clipEndSec;

    const videoElement = videoRef.current;
    if (!videoElement || Number.isNaN(videoElement.duration)) {
      return;
    }

    const maxSeek = Number.isFinite(videoElement.duration)
      ? Math.max(clipStartSec, videoElement.duration - 0.01)
      : clipEndSec;
    if (videoElement.currentTime < clipStartSec || videoElement.currentTime > clipEndSec) {
      videoElement.currentTime = clamp(clipStartSec, 0, maxSeek);
    }
  }, [clipEndSec, clipStartSec]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    let hls: Hls | null = null;
    let cancelled = false;

    const canUseNative = videoElement.canPlayType("application/vnd.apple.mpegurl");
    const loadingTimeout = window.setTimeout(() => {
      setErrorMessage((previous) =>
        previous ?? "La previsualizacion tarda demasiado en cargar.",
      );
      setIsLoading(false);
    }, 12_000);

    if (canUseNative) {
      videoElement.src = playbackUrl;

      void (async () => {
        try {
          const response = await fetch(playbackUrl, { method: "GET", cache: "no-store" });
          if (!response.ok) {
            return;
          }

          const manifest = await response.text();
          if (!manifest.includes("#EXT-X-STREAM-INF")) {
            return;
          }

          const variants = parseNativeHlsVariants(manifest, playbackUrl);
          if (cancelled || variants.length === 0) {
            return;
          }

          nativeMapRef.current = Object.fromEntries(
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
          // Keep auto mode
        }
      })();
    } else if (Hls.isSupported()) {
      const instance = new Hls({ enableWorker: true });
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
      });

      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setErrorMessage("No se pudo cargar la previsualizacion.");
          setIsLoading(false);
        }
      });

      instance.loadSource(playbackUrl);
      instance.attachMedia(videoElement);
    } else {
      queueMicrotask(() => {
        setErrorMessage("Tu navegador no soporta HLS para vista previa.");
        setIsLoading(false);
      });
      return;
    }

    const onLoadedMetadata = () => {
      window.clearTimeout(loadingTimeout);
      const maxSeek = Number.isFinite(videoElement.duration)
        ? Math.max(clipStartRef.current, videoElement.duration - 0.01)
        : clipEndRef.current;
      videoElement.currentTime = clamp(clipStartRef.current, 0, maxSeek);
      setIsLoading(false);
    };

    const onPlaybackError = () => {
      window.clearTimeout(loadingTimeout);
      setErrorMessage("No se pudo reproducir la vista previa.");
      setIsLoading(false);
    };

    videoElement.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    videoElement.addEventListener("error", onPlaybackError, { once: true });

    return () => {
      cancelled = true;

      if (hls) {
        hls.destroy();
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
      }

      window.clearTimeout(loadingTimeout);
      nativeMapRef.current = {};
      videoElement.removeEventListener("error", onPlaybackError);
      videoElement.removeAttribute("src");
      videoElement.load();
    };
  }, [playbackUrl]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const onTimeUpdate = () => {
      const start = clipStartRef.current;
      const end = clipEndRef.current;

      if (videoElement.currentTime < start) {
        videoElement.currentTime = start;
        return;
      }

      if (videoElement.currentTime >= end) {
        if (!loopEnabled) {
          videoElement.pause();
          videoElement.currentTime = start;
          return;
        }

        videoElement.currentTime = start;
      }
    };

    videoElement.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      videoElement.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [loopEnabled]);

  const onChangeQuality = useCallback((value: string) => {
    setSelectedQuality(value);

    const hls = hlsRef.current;
    if (hls) {
      if (value === QUALITY_AUTO) {
        hls.currentLevel = -1;
        hls.nextLevel = -1;
        return;
      }

      const index = Number(value);
      if (Number.isInteger(index) && index >= 0 && index < hls.levels.length) {
        hls.currentLevel = index;
        hls.nextLevel = index;
      }
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const nextSource = value === QUALITY_AUTO
      ? playbackUrl
      : nativeMapRef.current[value] ?? null;
    if (!nextSource) {
      return;
    }

    const resumeTime = videoElement.currentTime;
    const wasPaused = videoElement.paused;

    videoElement.src = nextSource;
    videoElement.addEventListener("loadedmetadata", () => {
      const maxSeek = Number.isFinite(videoElement.duration)
        ? Math.max(clipStartRef.current, videoElement.duration - 0.01)
        : clipEndRef.current;
      videoElement.currentTime = clamp(resumeTime, clipStartRef.current, maxSeek);

      if (!wasPaused) {
        videoElement.play().catch(() => {
          // Ignore autoplay rejection.
        });
      }
    }, { once: true });
  }, [playbackUrl]);

  const onPlayPreview = useCallback(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const maxSeek = Number.isFinite(videoElement.duration)
      ? Math.max(clipStartSec, videoElement.duration - 0.01)
      : clipEndSec;
    videoElement.currentTime = clamp(clipStartSec, 0, maxSeek);
    videoElement.play().catch(() => {
      // Ignore autoplay rejection.
    });
  }, [clipEndSec, clipStartSec]);

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Previsualizacion del recorte</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedQuality}
            onValueChange={onChangeQuality}
            disabled={qualityOptions.length <= 1}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
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
          <Button
            type="button"
            size="sm"
            variant={loopEnabled ? "secondary" : "outline"}
            onClick={() => setLoopEnabled((value) => !value)}
          >
            {loopEnabled ? "Loop activo" : "Loop inactivo"}
          </Button>
          <Button type="button" size="sm" onClick={onPlayPreview}>
            <Play className="mr-1 h-3.5 w-3.5" />
            Previsualizar
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          poster={posterUrl ?? undefined}
          className="h-auto w-full"
        />
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-xs text-white">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Cargando previsualizacion...
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        La vista previa respeta inicio/fin del recorte y se actualiza al editar.
      </p>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
