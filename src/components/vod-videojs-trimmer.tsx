"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  registerVideoJsTrimmer,
  type VideoJsTrimmerInstance,
} from "@/lib/videojs-trimmer-plugin";

type RangeChangePayload = {
  startSec: number;
  endSec: number;
};

type VodVideoJsTrimmerProps = {
  sourceUrl: string;
  posterUrl: string | null;
  clipStartSec: number;
  clipEndSec: number;
  onRangeChange: (payload: RangeChangePayload) => void;
  onTimeChange?: (currentSec: number) => void;
};

type VideoJsPlayer = {
  trimmer?: () => VideoJsTrimmerInstance;
  currentTime: () => number;
  duration: () => number;
  dispose: () => void;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  off: (eventName: string, handler: (...args: unknown[]) => void) => void;
};

const HLS_MIME_TYPE = "application/x-mpegURL";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toProxyMediaUrl(sourceUrl: string): string {
  const params = new URLSearchParams();
  params.set("u", sourceUrl);
  return `/api/kick/media?${params.toString()}`;
}

export function VodVideoJsTrimmer({
  sourceUrl,
  posterUrl,
  clipStartSec,
  clipEndSec,
  onRangeChange,
  onTimeChange,
}: VodVideoJsTrimmerProps) {
  const proxySourceUrl = useMemo(() => toProxyMediaUrl(sourceUrl), [sourceUrl]);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<VideoJsPlayer | null>(null);
  const trimmerRef = useRef<VideoJsTrimmerInstance | null>(null);
  const latestRangeRef = useRef({ startSec: clipStartSec, endSec: clipEndSec });
  const onRangeChangeRef = useRef(onRangeChange);
  const onTimeChangeRef = useRef(onTimeChange);

  useEffect(() => {
    latestRangeRef.current = { startSec: clipStartSec, endSec: clipEndSec };
  }, [clipEndSec, clipStartSec]);

  useEffect(() => {
    onRangeChangeRef.current = onRangeChange;
  }, [onRangeChange]);

  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  }, [onTimeChange]);

  useEffect(() => {
    let disposed = false;

    const setupPlayer = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);

        const [{ default: videojs }] = await Promise.all([
          import("video.js"),
          import("videojs-offset"),
        ]);

        registerVideoJsTrimmer(
          videojs as unknown as Parameters<typeof registerVideoJsTrimmer>[0],
        );

        if (disposed || !containerRef.current) {
          return;
        }

        const videoElement = document.createElement("video-js");
        videoElement.className = "vjs-default-skin vjs-big-play-centered";
        videoElement.setAttribute("playsinline", "true");

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(videoElement);

        const player = videojs(videoElement, {
          autoplay: false,
          controls: true,
          fluid: true,
          preload: "auto",
          poster: posterUrl ?? undefined,
          sources: [{ src: proxySourceUrl, type: HLS_MIME_TYPE }],
        }) as unknown as VideoJsPlayer;

        playerRef.current = player;

        const onLoadedMetadata = () => {
          const duration = Math.floor(Number(player.duration()) || 0);
          if (duration <= 0) {
            setIsLoading(false);
            return;
          }

          const trimmer = typeof player.trimmer === "function" ? player.trimmer() : null;
          trimmerRef.current = trimmer;

          if (trimmer) {
            const safeStart = clamp(
              Math.floor(latestRangeRef.current.startSec),
              0,
              Math.max(0, duration - 1),
            );
            const safeEnd = clamp(
              Math.floor(latestRangeRef.current.endSec),
              safeStart + 1,
              duration,
            );
            trimmer.setRange(safeStart, safeEnd, false);
            onRangeChangeRef.current({ startSec: safeStart, endSec: safeEnd });
          }

          setIsLoading(false);
        };

        const onTrimmerChange = (...args: unknown[]) => {
          const dataRaw = args[1];
          if (!dataRaw || typeof dataRaw !== "object") {
            return;
          }

          const data = dataRaw as { startTime?: unknown; endTime?: unknown };
          const rawStart = Number(data.startTime);
          const rawEnd = Number(data.endTime);
          if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
            return;
          }

          const duration = Math.max(1, Math.floor(Number(player.duration()) || 0));
          const startSec = clamp(Math.floor(rawStart), 0, Math.max(0, duration - 1));
          const endSec = clamp(Math.floor(rawEnd), startSec + 1, duration);

          onRangeChangeRef.current({ startSec, endSec });
        };

        const onTimeUpdate = () => {
          const now = Math.floor(Number(player.currentTime()) || 0);
          onTimeChangeRef.current?.(now);
        };

        const onPlayerError = () => {
          setErrorMessage("No se pudo cargar el editor del VOD.");
          setIsLoading(false);
        };

        player.on("loadedmetadata", onLoadedMetadata);
        player.on("trimmerchange", onTrimmerChange);
        player.on("timeupdate", onTimeUpdate);
        player.on("error", onPlayerError);
      } catch {
        if (!disposed) {
          setErrorMessage("No se pudo inicializar Video.js + Trimmer.");
          setIsLoading(false);
        }
      }
    };

    void setupPlayer();

    return () => {
      disposed = true;

      const player = playerRef.current;
      if (player) {
        player.dispose();
      }

      playerRef.current = null;
      trimmerRef.current = null;
    };
  }, [posterUrl, proxySourceUrl]);

  useEffect(() => {
    const player = playerRef.current;
    const trimmer = trimmerRef.current;
    if (!player || !trimmer) {
      return;
    }

    const duration = Math.floor(Number(player.duration()) || 0);
    if (duration <= 0) {
      return;
    }

    const safeStart = clamp(Math.floor(clipStartSec), 0, Math.max(0, duration - 1));
    const safeEnd = clamp(Math.floor(clipEndSec), safeStart + 1, duration);

    const currentStart = Math.floor(trimmer.startTime);
    const currentEnd = Math.floor(trimmer.endTime);

    if (Math.abs(currentStart - safeStart) < 1 && Math.abs(currentEnd - safeEnd) < 1) {
      return;
    }

    trimmer.setRange(safeStart, safeEnd, false);
  }, [clipEndSec, clipStartSec]);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-border/70 bg-black">
        <div
          ref={containerRef}
          className={cn("vod-trimmer-shell", isLoading && "opacity-80")}
        />
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-sm text-white">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Cargando editor...
          </div>
        )}
      </div>

      {errorMessage && (
        <p className="text-xs text-destructive">{errorMessage}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Arrastra los marcadores del timeline para ajustar inicio y fin del recorte.
      </p>
    </div>
  );
}
