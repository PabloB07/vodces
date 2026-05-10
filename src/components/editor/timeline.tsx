"use client";

import { useCallback, useRef, useState, useMemo } from "react";
import { useEditorStore } from "@/store/editor-store";
import type { Track, TimelineClip } from "@/types/editor";
import { GripVertical, Lock, Eye, EyeOff, Plus, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";

const TRACK_HEIGHT = 48;
const CLIP_MIN_WIDTH = 4;
const RULER_HEIGHT = 24;
const PX_PER_SEC_BASE = 80;

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 30);
  return `${m}:${s.toString().padStart(2, "0")}:${ms.toString().padStart(2, "0")}`;
}

type DragType = "move" | "resize-start" | "resize-end";

type DragState = {
  type: DragType;
  clipId: string;
  trackId: string;
  startX: number;
  clipStart: number;
  clipEnd: number;
} | null;

export default function Timeline() {
  const tracks = useEditorStore((s) => s.tracks);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorStore((s) => s.setSelectedClipIds);
  const duration = useEditorStore((s) => s.duration);
  const pushUndo = useEditorStore((s) => s.pushUndo);
  const splitClip = useEditorStore((s) => s.splitClip);
  const resizeClip = useEditorStore((s) => s.resizeClip);
  const moveClip = useEditorStore((s) => s.moveClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);

  const pxPerSec = PX_PER_SEC_BASE * zoom;
  const totalWidth = Math.max(duration * pxPerSec + 200, 600);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [playingLocally, setPlayingLocally] = useState(false);

  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    const time = x / pxPerSec;
    setCurrentTime(Math.max(0, Math.min(time, duration)));
  }, [pxPerSec, duration, setCurrentTime]);

  const handleClipMouseDown = useCallback((e: React.MouseEvent, trackId: string, clip: TimelineClip, type: DragType) => {
    e.stopPropagation();
    pushUndo();
    setDrag({ type, clipId: clip.id, trackId, startX: e.clientX, clipStart: clip.start, clipEnd: clip.end });
    setSelectedClipIds([clip.id]);
  }, [pushUndo, setSelectedClipIds]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / pxPerSec;
    const snap = snapEnabled ? 1 / 30 : 0;
    if (drag.type === "move") {
      const newStart = Math.max(0, snap ? Math.round((drag.clipStart + dx) / snap) * snap : drag.clipStart + dx);
      const newEnd = newStart + (drag.clipEnd - drag.clipStart);
      if (newEnd <= duration) {
        moveClip(drag.trackId, drag.clipId, drag.trackId, newStart);
      }
    } else if (drag.type === "resize-start") {
      let newStart = Math.max(0, snap ? Math.round((drag.clipStart + dx) / snap) * snap : drag.clipStart + dx);
      if (newStart < drag.clipEnd - 0.1) {
        resizeClip(drag.trackId, drag.clipId, newStart, drag.clipEnd);
      }
    } else if (drag.type === "resize-end") {
      let newEnd = snap ? Math.round((drag.clipEnd + dx) / snap) * snap : drag.clipEnd + dx;
      if (newEnd <= duration && newEnd > drag.clipStart + 0.1) {
        resizeClip(drag.trackId, drag.clipId, drag.clipStart, newEnd);
      }
    }
  }, [drag, pxPerSec, snapEnabled, duration, moveClip, resizeClip]);

  const handleMouseUp = useCallback(() => {
    setDrag(null);
  }, []);

  const handleSplit = useCallback(() => {
    if (selectedClipIds.length === 1) {
      const clipId = selectedClipIds[0];
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          pushUndo();
          splitClip(track.id, clipId, currentTime);
          break;
        }
      }
    }
  }, [selectedClipIds, tracks, currentTime, pushUndo, splitClip]);

  const handleDelete = useCallback(() => {
    if (selectedClipIds.length === 1) {
      const clipId = selectedClipIds[0];
      for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) { pushUndo(); removeClip(track.id, clipId); break; }
      }
    }
  }, [selectedClipIds, tracks, pushUndo, removeClip]);

  const typeColors: Record<string, string> = {
    video: "bg-blue-600/80 border-blue-400",
    audio: "bg-green-600/80 border-green-400",
    text: "bg-purple-600/80 border-purple-400",
    image: "bg-amber-600/80 border-amber-400",
    overlay: "bg-rose-600/80 border-rose-400",
  };

  return (
    <div className="flex flex-col h-full bg-editor-panel-bg border-t border-editor-glass-border select-none">
      <div className="flex items-center justify-between px-2 py-1 border-b border-editor-glass-border bg-black/20">
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(zoom * 1.2)} className="p-1 text-muted-foreground hover:text-foreground"><ZoomIn className="h-3.5 w-3.5" /></button>
          <button onClick={() => setZoom(zoom / 1.2)} className="p-1 text-muted-foreground hover:text-foreground"><ZoomOut className="h-3.5 w-3.5" /></button>
          <span className="text-[10px] text-muted-foreground w-10">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <input type="checkbox" checked={snapEnabled} onChange={() => setSnapEnabled(!snapEnabled)} className="accent-editor-accent" />
            Snap
          </label>
          <button onClick={handleSplit} disabled={selectedClipIds.length !== 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><Scissors className="h-3.5 w-3.5" /></button>
          <button onClick={handleDelete} disabled={selectedClipIds.length !== 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
          <button onClick={() => addTrack({ id: `track-${Date.now()}`, name: `Track ${tracks.length + 1}`, type: "overlay", locked: false, visible: true })} className="p-1 text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <div style={{ width: totalWidth, minWidth: "100%", position: "relative" }}>
          <div className="flex h-6 border-b border-editor-glass-border bg-black/40 sticky top-0 z-10" onClick={handleRulerClick}>
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => {
              const visible = zoom >= 1 ? i % Math.max(1, Math.round(2 / zoom)) === 0 : i % Math.max(1, Math.round(5 / zoom)) === 0;
              return visible ? (
                <div key={i} className="absolute top-0 h-full border-l border-editor-glass-border/50" style={{ left: i * pxPerSec }}>
                  <span className="absolute left-1 top-0.5 text-[9px] text-muted-foreground">{formatTime(i)}</span>
                </div>
              ) : null;
            })}
            <div className="absolute top-0 w-0.5 h-full bg-editor-accent z-20 pointer-events-none" style={{ left: currentTime * pxPerSec }} />
          </div>

          {tracks.map((track) => (
            <div key={track.id} className="flex border-b border-editor-glass-border/30 hover:bg-white/[0.02]">
              <div className="flex items-center gap-1 w-36 shrink-0 border-r border-editor-glass-border bg-black/30 px-2 text-[10px] text-muted-foreground">
                <GripVertical className="h-3 w-3 opacity-30" />
                <span className="flex-1 truncate">{track.name}</span>
                <button className="p-0.5 hover:text-foreground">{track.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</button>
                <button className="p-0.5 hover:text-foreground"><Lock className="h-3 w-3" /></button>
              </div>
              <div className="relative flex-1" style={{ height: TRACK_HEIGHT }}>
                {track.clips.map((clip) => {
                  const left = clip.start * pxPerSec;
                  const width = Math.max((clip.end - clip.start) * pxPerSec, CLIP_MIN_WIDTH);
                  const isSelected = selectedClipIds.includes(clip.id);
                  const colorClass = typeColors[clip.type] || "bg-gray-600/80 border-gray-400";
                  return (
                    <div
                      key={clip.id}
                      className={`absolute top-1 rounded cursor-pointer border ${colorClass} ${isSelected ? "ring-2 ring-editor-accent z-10" : ""}`}
                      style={{ left, width, height: TRACK_HEIGHT - 4 }}
                      onClick={(e) => { e.stopPropagation(); setSelectedClipIds([clip.id]); }}
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-l"
                        onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, "resize-start")}
                      />
                      <div className="flex items-center justify-center h-full px-1">
                        <span className="text-[9px] text-white truncate">{clip.name}</span>
                      </div>
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 rounded-r"
                        onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, "resize-end")}
                      />
                      <div
                        className="absolute inset-0 cursor-grab active:cursor-grabbing"
                        onMouseDown={(e) => handleClipMouseDown(e, track.id, clip, "move")}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
