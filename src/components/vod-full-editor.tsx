"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  Scissors,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VodClipPreview } from "@/components/vod-clip-preview";
import { VodVideoJsTrimmer } from "@/components/vod-videojs-trimmer";

type Props = {
  defaultStreamer: string;
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
};

type StreamerResponse = {
  vods: VodItem[];
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

const VIDEO_UUID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;
const DEFAULT_SNAP_STEP_SEC = 1;
const MAX_MP4_EXPORT_SECONDS = 900;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseSafeInteger(raw: string | null): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function sanitizeVideoUuid(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim();
  if (!VIDEO_UUID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
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

function sanitizeMediaUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  try {
    const value = raw.trim();
    const parsed = new URL(value);

    if (parsed.protocol !== "https:") {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
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

    return parsed.toString();
  } catch {
    return null;
  }
}

function roundToStep(value: number, step: number): number {
  if (step <= 1) {
    return value;
  }

  return Math.round(value / step) * step;
}

export default function VodFullEditor({ defaultStreamer }: Props) {
  const searchParams = useSearchParams();
  const rawUuid = searchParams.get("uuid");
  const initialStart = parseSafeInteger(searchParams.get("start"));
  const initialEnd = parseSafeInteger(searchParams.get("end"));

  const videoUuid = useMemo(() => sanitizeVideoUuid(rawUuid), [rawUuid]);

  const [selectedVod, setSelectedVod] = useState<VodItem | null>(null);
  const [selectedSource, setSelectedSource] = useState<VideoSourceResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [clipStartSec, setClipStartSec] = useState(0);
  const [clipEndSec, setClipEndSec] = useState<number | null>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [snapStepSec, setSnapStepSec] = useState(DEFAULT_SNAP_STEP_SEC);

  useEffect(() => {
    if (!videoUuid) {
      setLoading(false);
      setErrorMessage("UUID de VOD inválido. Abre la edición desde Home.");
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const [streamerResponse, sourceResponse] = await Promise.all([
          fetch(`/api/kick/streamer/${encodeURIComponent(defaultStreamer)}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/kick/video/${encodeURIComponent(videoUuid)}`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        if (!streamerResponse.ok) {
          throw new Error("No se pudo validar el VOD del streamer.");
        }

        if (!sourceResponse.ok) {
          throw new Error("No se pudo cargar la fuente del VOD.");
        }

        const streamerPayload = (await streamerResponse.json()) as StreamerResponse;
        const sourcePayload = (await sourceResponse.json()) as VideoSourceResponse;

        const vod = streamerPayload.vods.find((item) =>
          item.videoUuid === videoUuid && item.isLive !== true
        ) ?? null;

        if (!vod) {
          throw new Error("VOD no encontrado en el canal elcesarlive.");
        }

        const safeSourceUrl = sanitizeMediaUrl(sourcePayload.sourceUrl);
        if (!safeSourceUrl) {
          throw new Error("Fuente m3u8 inválida para edición.");
        }

        if (cancelled) {
          return;
        }

        setSelectedVod(vod);
        setSelectedSource({
          ...sourcePayload,
          sourceUrl: safeSourceUrl,
          kickUrl: vod.kickUrl,
        });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Error al abrir editor.";
          setErrorMessage(message);
          setSelectedVod(null);
          setSelectedSource(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [defaultStreamer, videoUuid]);

  const effectiveDurationSeconds = useMemo(() => {
    const durationMs = selectedSource?.durationMs ?? selectedVod?.durationMs ?? null;
    if (!durationMs || durationMs <= 0) {
      return 0;
    }

    return Math.floor(durationMs / 1000);
  }, [selectedSource?.durationMs, selectedVod?.durationMs]);

  useEffect(() => {
    if (!selectedVod || !selectedSource) {
      return;
    }

    const fallbackEnd = effectiveDurationSeconds > 0 ? effectiveDurationSeconds : 30;
    const rawStart = initialStart ?? 0;
    const rawEnd = initialEnd ?? Math.min(fallbackEnd, rawStart + MAX_MP4_EXPORT_SECONDS);

    const safeStart = clampNumber(rawStart, 0, Math.max(0, fallbackEnd - 1));
    const safeEnd = clampNumber(rawEnd, safeStart + 1, Math.max(safeStart + 1, fallbackEnd));

    setClipStartSec(safeStart);
    setClipEndSec(safeEnd);
    setCurrentTimeSec(safeStart);
    setCopyMessage(null);
  }, [effectiveDurationSeconds, initialEnd, initialStart, selectedSource, selectedVod]);

  const onTrimmerRangeChange = useCallback((payload: { startSec: number; endSec: number }) => {
    const start = Math.floor(payload.startSec);
    const end = Math.floor(payload.endSec);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }

    setClipStartSec((previous) => (previous === start ? previous : start));
    setClipEndSec((previous) => (previous === end ? previous : end));
  }, []);

  const onTrimmerTimeChange = useCallback((nextSec: number) => {
    if (!Number.isFinite(nextSec)) {
      return;
    }

    setCurrentTimeSec((previous) => (previous === nextSec ? previous : nextSec));
  }, []);

  const onNudgeStart = useCallback((deltaSeconds: number) => {
    const maxStart = clipEndSec !== null
      ? Math.max(0, clipEndSec - 1)
      : Math.max(0, effectiveDurationSeconds - 1);
    const nextValue = roundToStep(clipStartSec + deltaSeconds, snapStepSec);
    setClipStartSec(clampNumber(nextValue, 0, maxStart));
  }, [clipEndSec, clipStartSec, effectiveDurationSeconds, snapStepSec]);

  const onNudgeEnd = useCallback((deltaSeconds: number) => {
    const minEnd = clipStartSec + 1;
    const maxEnd = Math.max(minEnd, effectiveDurationSeconds);
    const currentEnd = clipEndSec ?? maxEnd;
    const nextValue = roundToStep(currentEnd + deltaSeconds, snapStepSec);
    setClipEndSec(clampNumber(nextValue, minEnd, maxEnd));
  }, [clipEndSec, clipStartSec, effectiveDurationSeconds, snapStepSec]);

  const onMarkStart = useCallback(() => {
    const now = Math.floor(currentTimeSec);
    const maxStart = clipEndSec !== null
      ? Math.max(0, clipEndSec - 1)
      : Math.max(0, effectiveDurationSeconds - 1);
    const snapped = roundToStep(now, snapStepSec);
    setClipStartSec(clampNumber(snapped, 0, maxStart));
  }, [clipEndSec, currentTimeSec, effectiveDurationSeconds, snapStepSec]);

  const onMarkEnd = useCallback(() => {
    const now = Math.floor(currentTimeSec);
    const minEnd = clipStartSec + 1;
    const maxEnd = effectiveDurationSeconds > 0 ? effectiveDurationSeconds : Math.max(minEnd, now);
    const snapped = roundToStep(now, snapStepSec);
    setClipEndSec(clampNumber(snapped, minEnd, maxEnd));
  }, [clipStartSec, currentTimeSec, effectiveDurationSeconds, snapStepSec]);

  const onSetClipPreset = useCallback((lengthSeconds: number) => {
    const now = clampNumber(currentTimeSec, 0, Math.max(0, effectiveDurationSeconds - 1));
    const maxEnd = Math.max(now + 1, effectiveDurationSeconds);

    const nextStart = clampNumber(roundToStep(now, snapStepSec), 0, Math.max(0, maxEnd - 1));
    const nextEnd = clampNumber(
      roundToStep(now + lengthSeconds, snapStepSec),
      nextStart + 1,
      maxEnd,
    );

    setClipStartSec(nextStart);
    setClipEndSec(nextEnd);
  }, [currentTimeSec, effectiveDurationSeconds, snapStepSec]);

  const onResetEdit = useCallback(() => {
    const defaultEnd = effectiveDurationSeconds > 0 ? effectiveDurationSeconds : null;
    setClipStartSec(0);
    setClipEndSec(defaultEnd);
    setCurrentTimeSec(0);
    setCopyMessage(null);
  }, [effectiveDurationSeconds]);

  const onCopyEditInfo = useCallback(async () => {
    if (!selectedVod) {
      return;
    }

    const endValue = clipEndSec ?? effectiveDurationSeconds;
    const clipLink = `${selectedVod.kickUrl}?st=${clipStartSec}&et=${endValue}`;
    const text = [
      `VOD: ${selectedVod.title}`,
      `Inicio: ${formatSeconds(clipStartSec)}`,
      `Fin: ${formatSeconds(endValue)}`,
      `URL: ${clipLink}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Segmento copiado al portapapeles.");
    } catch {
      setCopyMessage("No se pudo copiar automáticamente.");
    }
  }, [clipEndSec, clipStartSec, effectiveDurationSeconds, selectedVod]);

  const clipLengthSec = Math.max(1, (clipEndSec ?? effectiveDurationSeconds) - clipStartSec);
  const clipCoveragePercent = effectiveDurationSeconds > 0
    ? Math.min(100, (clipLengthSec / effectiveDurationSeconds) * 100)
    : 0;
  const clipEndForEditor = clipEndSec
    ?? Math.max(clipStartSec + 1, effectiveDurationSeconds > 0 ? effectiveDurationSeconds : clipStartSec + 30);

  const exportClipEndSec = clipEndSec ?? effectiveDurationSeconds;
  const exportM3u8Url = useMemo(() => {
    if (!selectedSource || !selectedVod || exportClipEndSec <= clipStartSec) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("u", selectedSource.sourceUrl);
    params.set("start", String(clipStartSec));
    params.set("end", String(exportClipEndSec));
    params.set("name", `${selectedVod.videoUuid}-${clipStartSec}-${exportClipEndSec}`);
    return `/api/kick/export/m3u8?${params.toString()}`;
  }, [clipStartSec, exportClipEndSec, selectedSource, selectedVod]);

  const exportEndSec = clipEndSec === null
    ? null
    : Math.min(clipEndSec, clipStartSec + MAX_MP4_EXPORT_SECONDS);
  const exportIsTrimmedByLimit = clipEndSec !== null && exportEndSec !== null && exportEndSec < clipEndSec;
  const exportMp4Url = useMemo(() => {
    if (!selectedSource || !selectedVod || exportEndSec === null || clipLengthSec <= 0) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("u", selectedSource.sourceUrl);
    params.set("start", String(clipStartSec));
    params.set("end", String(exportEndSec));
    params.set("name", `${selectedVod.videoUuid}-${clipStartSec}-${exportEndSec}`);
    return `/api/kick/export/mp4?${params.toString()}`;
  }, [clipLengthSec, clipStartSec, exportEndSec, selectedSource, selectedVod]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Volver al Home
            </Link>
          </Button>
          <Badge className="bg-emerald-500 text-black hover:bg-emerald-500">
            Editor full • {defaultStreamer}
          </Badge>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Cargando editor del VOD...
            </CardContent>
          </Card>
        )}

        {!loading && selectedVod && selectedSource && (
          <Card className="border-border/70 bg-card/95 shadow-lg">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="line-clamp-2 flex items-center gap-2">
                    <Scissors className="h-4 w-4" />
                    {selectedVod.title}
                  </CardTitle>
                  <CardDescription>
                    {formatDateTime(selectedVod.createdAt)} • {formatDuration(selectedVod.durationMs)}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={selectedVod.kickUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-4 w-4" />
                      Ver en Kick
                    </a>
                  </Button>
                  {exportM3u8Url ? (
                    <Button asChild size="sm">
                      <a
                        href={exportM3u8Url}
                        rel="noopener noreferrer"
                      >
                        <Download className="mr-1 h-4 w-4" />
                        Descargar m3u8
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" disabled>
                      <Download className="mr-1 h-4 w-4" />
                      Descargar m3u8
                    </Button>
                  )}
                  {exportMp4Url ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href={exportMp4Url}>
                        <Download className="mr-1 h-4 w-4" />
                        Descargar MP4
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled>
                      <Download className="mr-1 h-4 w-4" />
                      Descargar MP4
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Editor del recorte
                  </p>
                  <VodVideoJsTrimmer
                    sourceUrl={selectedSource.sourceUrl}
                    posterUrl={selectedVod.thumbnailUrl ?? null}
                    clipStartSec={clipStartSec}
                    clipEndSec={clipEndForEditor}
                    onRangeChange={onTrimmerRangeChange}
                    onTimeChange={onTrimmerTimeChange}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Vista previa en paralelo
                  </p>
                  <VodClipPreview
                    sourceUrl={selectedSource.sourceUrl}
                    posterUrl={selectedVod.thumbnailUrl ?? null}
                    clipStartSec={clipStartSec}
                    clipEndSec={clipEndForEditor}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2">
                  <p className="text-[11px] text-muted-foreground">Inicio</p>
                  <p className="text-sm font-medium">{formatSeconds(clipStartSec)}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2">
                  <p className="text-[11px] text-muted-foreground">Fin</p>
                  <p className="text-sm font-medium">{formatSeconds(clipEndSec ?? effectiveDurationSeconds)}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2">
                  <p className="text-[11px] text-muted-foreground">Duración recorte</p>
                  <p className="text-sm font-medium">{formatSeconds(clipLengthSec)}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2">
                  <p className="text-[11px] text-muted-foreground">Cobertura</p>
                  <p className="text-sm font-medium">{clipCoveragePercent.toFixed(1)}%</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Inicio (segundos)</span>
                  <Input
                    type="number"
                    min={0}
                    max={Math.max(0, (clipEndSec ?? effectiveDurationSeconds) - 1)}
                    value={clipStartSec}
                    onChange={(event) => {
                      const parsed = Math.floor(Number(event.target.value));
                      if (!Number.isFinite(parsed)) {
                        return;
                      }

                      const maxStart = clipEndSec !== null
                        ? Math.max(0, clipEndSec - 1)
                        : Math.max(0, effectiveDurationSeconds - 1);
                      setClipStartSec(clampNumber(roundToStep(parsed, snapStepSec), 0, maxStart));
                    }}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Fin (segundos)</span>
                  <Input
                    type="number"
                    min={clipStartSec + 1}
                    max={Math.max(clipStartSec + 1, effectiveDurationSeconds)}
                    value={clipEndSec ?? ""}
                    onChange={(event) => {
                      const parsed = Math.floor(Number(event.target.value));
                      if (!Number.isFinite(parsed)) {
                        return;
                      }

                      const minEnd = clipStartSec + 1;
                      const maxEnd = Math.max(minEnd, effectiveDurationSeconds);
                      setClipEndSec(clampNumber(roundToStep(parsed, snapStepSec), minEnd, maxEnd));
                    }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <Button variant="outline" size="sm" onClick={() => onNudgeStart(-5)}>
                  Inicio -5s
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNudgeStart(5)}>
                  Inicio +5s
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNudgeEnd(-5)}>
                  Fin -5s
                </Button>
                <Button variant="outline" size="sm" onClick={() => onNudgeEnd(5)}>
                  Fin +5s
                </Button>
                <Button variant="secondary" size="sm" onClick={onMarkStart}>
                  Marcar inicio
                </Button>
                <Button variant="secondary" size="sm" onClick={onMarkEnd}>
                  Marcar fin
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button variant="outline" size="sm" onClick={onResetEdit}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Reset
                </Button>
                <Button variant="outline" size="sm" onClick={() => onSetClipPreset(15)}>
                  Preset 15s
                </Button>
                <Button variant="outline" size="sm" onClick={() => onSetClipPreset(30)}>
                  Preset 30s
                </Button>
                <Select
                  value={String(snapStepSec)}
                  onValueChange={(value) => {
                    const parsed = Number(value);
                    if (Number.isInteger(parsed) && parsed > 0) {
                      setSnapStepSec(parsed);
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Snap" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Snap 1s</SelectItem>
                    <SelectItem value="5">Snap 5s</SelectItem>
                    <SelectItem value="10">Snap 10s</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-border/80 bg-muted/30 p-3 text-sm">
                <p className="text-muted-foreground">
                  Tiempo actual: <strong>{formatSeconds(currentTimeSec)}</strong>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Segmento: <strong>{formatSeconds(clipStartSec)}</strong> - {" "}
                  <strong>{formatSeconds(clipEndSec ?? effectiveDurationSeconds)}</strong>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void onCopyEditInfo()}>
                    <Copy className="mr-1 h-3.5 w-3.5" />
                    Copiar recorte
                  </Button>
                </div>
                {copyMessage && (
                  <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                    {copyMessage}
                  </p>
                )}
                {exportIsTrimmedByLimit ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    El MP4 exporta un maximo de {Math.floor(MAX_MP4_EXPORT_SECONDS / 60)} min por archivo.
                    El m3u8 mantiene el tramo completo seleccionado.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Puedes descargar este recorte en m3u8 o MP4 desde los botones superiores.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
