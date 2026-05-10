"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";

const TRANSITIONS = [
  { id: "crossfade", label: "Crossfade", icon: "↔" },
  { id: "dissolve", label: "Dissolve", icon: "◐" },
  { id: "wipe-left", label: "Wipe Left", icon: "▸" },
  { id: "wipe-right", label: "Wipe Right", icon: "◂" },
  { id: "slide-left", label: "Slide Left", icon: "⇒" },
  { id: "slide-right", label: "Slide Right", icon: "⇐" },
  { id: "zoom-in", label: "Zoom In", icon: "⊕" },
  { id: "zoom-out", label: "Zoom Out", icon: "⊖" },
];

export default function TransitionsPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [duration, setDuration] = useState(0.5);

  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const tracks = useEditorStore((s) => s.tracks);
  const updateClip = useEditorStore((s) => s.updateClip);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const selectedClip = selectedClipIds.length === 1
    ? tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipIds[0])
    : null;

  const applyTransition = (id: string) => {
    setSelected(id);
    if (!selectedClip) return;
    pushUndo();
    updateClip(selectedClip.trackId, selectedClip.id, {
      props: { ...selectedClip.props, transition: { type: id, duration } },
    });
  };

  return (
    <div className="p-3">
      {!selectedClip && (
        <p className="text-[10px] text-muted-foreground mb-2">Select a clip on the timeline first</p>
      )}
      <div className="grid grid-cols-4 gap-2">
        {TRANSITIONS.map((t) => (
          <button key={t.id} onClick={() => applyTransition(t.id)}
            className={`flex flex-col items-center gap-1 p-2 rounded border text-xs transition-colors ${
              selected === t.id
                ? "border-editor-accent bg-editor-accent/10 text-editor-accent"
                : "border-editor-glass-border text-muted-foreground hover:border-editor-accent/50"
            }`}
          >
            <span className="text-lg">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <label className="text-[10px] text-muted-foreground">Duration: {duration.toFixed(1)}s</label>
        <input type="range" min={0.1} max={2} step={0.1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="flex-1 accent-editor-accent" />
      </div>
      {!!selectedClip?.props?.transition && (
        <p className="text-[10px] text-editor-accent mt-2">
          Applied: {String((selectedClip.props.transition as any)?.type)} ({String((selectedClip.props.transition as any)?.duration)}s)
        </p>
      )}
    </div>
  );
}
