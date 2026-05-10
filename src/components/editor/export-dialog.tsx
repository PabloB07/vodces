"use client";

import { useState, useCallback, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import { X, LoaderCircle, Download, Film, Layers } from "lucide-react";

function getSourceUrl(clipSrc: string | undefined): string | null {
  if (!clipSrc) return null;
  try {
    const u = new URL(clipSrc, window.location.origin).searchParams.get("u");
    return u;
  } catch {
    return null;
  }
}

export default function ExportDialog() {
  const show = useEditorStore((s) => s.showExportDialog);
  const setShow = useEditorStore((s) => s.setShowExportDialog);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const updateExportSettings = useEditorStore((s) => s.updateExportSettings);
  const duration = useEditorStore((s) => s.duration);
  const tracks = useEditorStore((s) => s.tracks);

  const [encoding, setEncoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"server" | "canvas">("server");
  const abortRef = useRef<AbortController | null>(null);

  const videoClip = tracks.flatMap((t) => t.clips).find((c) => c.type === "video" && c.src);
  const sourceUrl = getSourceUrl(videoClip?.src);

  const startServerExport = useCallback(async () => {
    if (!sourceUrl) { setError("No video source URL available"); return; }
    setEncoding(true);
    setProgress(0);
    setError(null);

    const start = exportSettings.start;
    const end = exportSettings.end || Math.floor(duration);
    const params = new URLSearchParams({
      u: sourceUrl,
      start: String(start),
      end: String(end),
      name: "vod-clip",
    });

    try {
      const res = await fetch(`/api/kick/export/mp4?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Server returned ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vod-clip-${start}-${end}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
    setEncoding(false);
  }, [sourceUrl, exportSettings, duration]);

  const startCanvasExport = useCallback(async () => {
    setEncoding(true);
    setProgress(0);
    setError(null);

    const start = exportSettings.start;
    const end = exportSettings.end || Math.floor(duration);
    const exportDurationMs = (end - start) * 1000;

    try {
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("Compositor canvas not found");
      const stream = canvas.captureStream(exportSettings.fps);
      const mimeType = exportSettings.format === "webm" ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : 'video/webm' });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const done = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("Recording failed"));
      });

      recorder.start(100);

      const videoEl = document.querySelector("video");
      if (videoEl) {
        videoEl.currentTime = start;
        videoEl.play().catch(() => {});
      }

      const startTime = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startTime;
        setProgress(Math.min(99, Math.round((elapsed / exportDurationMs) * 100)));
        if (elapsed < exportDurationMs) {
          requestAnimationFrame(tick);
        } else {
          if (videoEl) videoEl.pause();
          recorder.stop();
        }
      };
      tick();

      await done;

      const ext = exportSettings.format === "webm" ? "webm" : "mp4";
      const blob = new Blob(chunks, { type: `video/${ext}` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vod-clip-composite-${start}-${end}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Canvas export failed");
    }
    setEncoding(false);
  }, [exportSettings, duration]);

  const startExport = useCallback(() => {
    if (mode === "server") startServerExport();
    else startCanvasExport();
  }, [mode, startServerExport, startCanvasExport]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShow(false)}>
      <div className="w-full max-w-md bg-editor-panel-bg border border-editor-glass-border rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-editor-glass-border">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground"><Film className="h-4 w-4 text-editor-accent" /> Export</h2>
          <button onClick={() => setShow(false)} className="p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setMode("server")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded border transition-colors ${
                mode === "server" ? "border-editor-accent bg-editor-accent/10 text-editor-accent" : "border-editor-glass-border text-muted-foreground"
              }`}>
              <Film className="h-3.5 w-3.5" /> Raw Video
            </button>
            <button onClick={() => setMode("canvas")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs rounded border transition-colors ${
                mode === "canvas" ? "border-editor-accent bg-editor-accent/10 text-editor-accent" : "border-editor-glass-border text-muted-foreground"
              }`}>
              <Layers className="h-3.5 w-3.5" /> With Overlays
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Format</span>
              <select value={exportSettings.format}
                onChange={(e) => updateExportSettings({ format: e.target.value as "mp4" | "webm" })}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground">
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Resolution</span>
              <select value={`${exportSettings.resolution.width}x${exportSettings.resolution.height}`}
                onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); updateExportSettings({ resolution: { width: w, height: h } }); }}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground">
                <option value="1920x1080">1080p</option>
                <option value="1080x1920">1080x1920 (TikTok)</option>
                <option value="1280x720">720p</option>
                <option value="1080x1080">1080x1080 (Square)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">FPS</span>
              <select value={exportSettings.fps} onChange={(e) => updateExportSettings({ fps: Number(e.target.value) })}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground">
                <option value={24}>24</option><option value={30}>30</option><option value={60}>60</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Quality</span>
              <input type="range" min={0.1} max={1} step={0.1} value={exportSettings.quality}
                onChange={(e) => updateExportSettings({ quality: Number(e.target.value) })}
                className="w-full accent-editor-accent" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Start (sec)</span>
              <input type="number" value={exportSettings.start} min={0} max={Math.max(0, duration - 1)}
                onChange={(e) => updateExportSettings({ start: Math.max(0, Number(e.target.value)) })}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">End (sec)</span>
              <input type="number" value={exportSettings.end || Math.floor(duration)} min={1} max={Math.floor(duration)}
                onChange={(e) => updateExportSettings({ end: Math.min(duration, Number(e.target.value)) })}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground" />
            </label>
          </div>

          {mode === "server" && (
            <p className="text-[10px] text-muted-foreground">
              Raw video export via server FFmpeg — fast, no overlays.
            </p>
          )}
          {mode === "canvas" && (
            <p className="text-[10px] text-muted-foreground">
              Captures the compositor canvas including text, effects, and shapes. Plays in real-time.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-editor-glass-border">
          {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}
          {encoding ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Encoding... {progress}%
              </div>
              <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                <div className="h-full bg-editor-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <button onClick={startExport}
              disabled={mode === "server" && !sourceUrl}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md bg-editor-accent text-black hover:bg-editor-accent/80 disabled:opacity-30">
              <Download className="h-3.5 w-3.5" /> Export {mode === "server" ? "Video" : "with Overlays"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
