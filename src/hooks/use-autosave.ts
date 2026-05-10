"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";

const KEY = "vodmoai-autosave";
const INTERVAL = 30_000;

export function useAutosave() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => {
      try {
        const s = useEditorStore.getState();
        localStorage.setItem(KEY, JSON.stringify({
          tracks: s.tracks,
          currentTime: s.currentTime,
          zoom: s.zoom,
          snapEnabled: s.snapEnabled,
          keyframes: s.keyframes,
          exportSettings: s.exportSettings,
          timestamp: Date.now(),
        }));
      } catch { /* silent */ }
    }, INTERVAL);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const restore = () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };

  return { restore };
}
