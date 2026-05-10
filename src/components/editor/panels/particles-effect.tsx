"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { Sparkles } from "lucide-react";

const PRESETS = [
  { id: "bubbles", label: "Bubbles", color: "#a855f7", opacity: 0.4, count: 40, speed: 1 },
  { id: "stars", label: "Stars", color: "#ffffff", opacity: 0.6, count: 60, speed: 0.3 },
  { id: "fireflies", label: "Fireflies", color: "#facc15", opacity: 0.7, count: 20, speed: 0.8 },
  { id: "snow", label: "Snow", color: "#94a3b8", opacity: 0.5, count: 80, speed: 0.5 },
];

export default function ParticlesEffect() {
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const addClip = useEditorStore((s) => s.addClip);
  const currentTime = useEditorStore((s) => s.currentTime);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const addEffect = (p: typeof PRESETS[number]) => {
    setAppliedId(p.id);
    pushUndo();
    addClip("track-overlay", {
      type: "effect",
      name: `Particles: ${p.label}`,
      start: currentTime,
      end: currentTime + 5,
      props: {
        effectType: "particles",
        count: p.count,
        color: p.color,
        speed: p.speed,
      },
    });
  };

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => addEffect(p)}
            className={`flex flex-col items-center gap-1 py-2 text-[10px] rounded border transition-colors ${
              appliedId === p.id
                ? "border-editor-accent bg-editor-accent/10 text-editor-accent"
                : "border-editor-glass-border text-muted-foreground hover:border-editor-accent/50"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {p.label}
          </button>
        ))}
      </div>
      {appliedId && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Effect added at {formatTime(currentTime)}
        </p>
      )}
    </div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
