"use client";

import Hls from "hls.js";
import Link from "next/link";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
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

function sanitizeMediaUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  try {
    const value = raw.trim();
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

  return variants.sort((a, b) => {
    if (a.height !== b.height) {
      return b.height - a.height;
    }
    return b.bandwidth - a.bandwidth;
  });
}

type MomentPlayerProps = {
  sourceUrl: string;
  title: string;
};

function MomentPlayer({ sourceUrl, title }: MomentPlayerProps) {
  const playbackUrl = useMemo(() => toProxyMediaUrl(sourceUrl), [sourceUrl]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([
    { value: QUALITY_AUTO, label: "Auto" },
  ]);
  const [selectedQuality, setSelectedQuality] = useState(QUALITY_AUTO);
  const [isLoading, setIsLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const nativeMapRef = useRef<Record<string, string>>({});

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
        previous ?? "El clip tarda demasiado en cargar. Intenta refrescar.",
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

          const variants = parseNativeHlsVariants(manifest, playbackUrl).filter(
            (variant) => sanitizeMediaUrl(variant.url) !== null,
          );

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
          // keep auto mode
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
          setErrorMessage("No se pudo reproducir el clip.");
        }
      });

      instance.loadSource(playbackUrl);
      instance.attachMedia(videoElement);
    } else {
      queueMicrotask(() => {
        setErrorMessage("Tu navegador no soporta HLS.");
        setIsLoading(false);
      });
      return;
    }

    const onReady = () => {
      window.clearTimeout(loadingTimeout);
      setIsLoading(false);
    };
    const onPlaybackError = () => {
      window.clearTimeout(loadingTimeout);
      setErrorMessage("No se pudo reproducir el clip.");
      setIsLoading(false);
    };

    videoElement.addEventListener("loadedmetadata", onReady, { once: true });
    videoElement.addEventListener("error", onPlaybackError, { once: true });
    videoElement.play().catch(() => {
      // ignore autoplay rejection
    });

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
    videoElement.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(resumeTime) && resumeTime > 0) {
          const maxSeek = Number.isFinite(videoElement.duration)
            ? Math.max(0, videoElement.duration - 1)
            : resumeTime;
          videoElement.currentTime = Math.min(resumeTime, maxSeek);
        }
        if (!wasPaused) {
          videoElement.play().catch(() => {
            // ignore autoplay rejection
          });
        }
      },
      { once: true },
    );
  }, [playbackUrl]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Volver
          </Link>
        </Button>
        <Badge variant="secondary">Visor fuera de Kick</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="line-clamp-2">{title || "Clip"}</CardTitle>
          <CardDescription>
            Reproducción directa del stream m3u8 sin abrir Kick.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Select
              value={selectedQuality}
              onValueChange={onChangeQuality}
              disabled={qualityOptions.length <= 1}
            >
              <SelectTrigger className="h-9 w-52">
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
            {isLoading && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Cargando...
              </span>
            )}
          </div>

          <video
            ref={videoRef}
            controls
            playsInline
            className="h-auto w-full rounded-lg bg-black"
          />

          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function MomentViewer() {
  const searchParams = useSearchParams();
  const title = (searchParams.get("title") ?? "Clip")
    .trim()
    .slice(0, 140);

  const sourceUrl = useMemo(
    () => sanitizeMediaUrl(searchParams.get("src")),
    [searchParams],
  );

  if (!sourceUrl) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
        <Alert variant="destructive" className="max-w-xl">
          <AlertTitle>URL invalida</AlertTitle>
          <AlertDescription>
            No se recibio una URL de clip valida.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return <MomentPlayer key={sourceUrl} sourceUrl={sourceUrl} title={title || "Clip"} />;
}
