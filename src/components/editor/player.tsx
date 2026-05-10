"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { renderFrame } from "@/components/editor/compositor";
import { Pause, Play, SkipBack, SkipForward, LoaderCircle, AlertCircle, Volume2, VolumeX } from "lucide-react";

export default function EditorPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<any>(null);
  const rafRef = useRef<number>(0);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const tracks = useEditorStore((s) => s.tracks);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const duration = useEditorStore((s) => s.duration);
  const setDuration = useEditorStore((s) => s.setDuration);
  const zoom = useEditorStore((s) => s.zoom);

  const videoClip = tracks.flatMap((t) => t.clips).find((c) => c.type === "video" && c.src);

  useEffect(() => {
    setError(null);
    setVideoReady(false);
    if (!videoClip?.src || !videoRef.current) return;
    const src: string = videoClip.src;
    let hls: any = null;

    const onVideoError = () => {
      const v = videoRef.current;
      const msg = v?.error?.message || "Unknown video error";
      setError(`Video error: ${msg}`);
    };
    videoRef.current.addEventListener("error", onVideoError);

    const isM3u8 = src.endsWith(".m3u8") || src.includes("m3u8");
    if (isM3u8) {
      import("hls.js").then((Hls) => {
        if (!videoRef.current) return;
        if (Hls.default.isSupported()) {
          hls = new Hls.default();
          hls.on(Hls.default.Events.ERROR, (_event: any, data: any) => {
            if (data.fatal) {
              setError(`HLS error: ${data.type} - ${data.details}`);
            }
          });
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);
          hlsRef.current = hls;
          hls.on(Hls.default.Events.MANIFEST_PARSED, () => {
            setVideoReady(true);
            if (videoRef.current) setDuration(videoRef.current.duration || duration);
          });
        } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
          videoRef.current.src = src;
          setVideoReady(true);
        } else {
          setError("HLS not supported in this browser");
        }
      });
    } else {
      videoRef.current.src = src;
      setVideoReady(true);
    }
    return () => {
      hls?.destroy();
      hlsRef.current = null;
      videoRef.current?.removeEventListener("error", onVideoError);
    };
  }, [videoClip?.src]);

  useEffect(() => {
    if (videoReady && isPlaying) {
      videoRef.current?.play().catch(() => {});
    } else {
      videoRef.current?.pause();
    }
  }, [videoReady, isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let running = true;
    const render = () => {
      if (!running) return;
      const storedTracks = useEditorStore.getState().tracks;
      renderFrame(ctx, video, storedTracks, video.currentTime, canvas.width, canvas.height);
      rafRef.current = requestAnimationFrame(render);
    };
    render();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [setCurrentTime]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = muted;
  }, [muted]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [isPlaying, setIsPlaying]);

  const seek = useCallback((delta: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + delta));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, setCurrentTime]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.code === "ArrowLeft") seek(-1);
      if (e.code === "ArrowRight") seek(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [togglePlay, seek]);

  return (
    <div className="relative flex flex-col items-center justify-center bg-black overflow-hidden rounded-lg w-full h-full">

      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        muted={muted}
        playsInline
        controls={false}
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        width={1280}
        height={720}
      />

      {!videoReady && videoClip && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <LoaderCircle className="h-6 w-6 animate-spin text-editor-accent" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-4">
          <AlertCircle className="h-6 w-6 text-red-400 mb-2" />
          <p className="text-xs text-red-300 text-center">{error}</p>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-30 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-2">
        <button onClick={() => seek(-5)} className="p-1 text-white/70 hover:text-white"><SkipBack className="h-4 w-4" /></button>
        <button onClick={togglePlay} className="p-1 text-white hover:text-editor-accent">
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <button onClick={() => seek(5)} className="p-1 text-white/70 hover:text-white"><SkipForward className="h-4 w-4" /></button>

        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          value={currentTime}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = t;
            setCurrentTime(t);
          }}
          className="flex-1 h-1 accent-editor-accent cursor-pointer"
        />

        <button onClick={() => setMuted(!muted)} className="p-1 text-white/70 hover:text-white">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <span className="text-[10px] text-white/60 tabular-nums w-20 text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
