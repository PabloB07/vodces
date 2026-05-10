"use client";

import { useState } from "react";
import { Player } from "@remotion/player";
import Composition from "@/components/editor/remotion/composition";
import { useEditorStore } from "@/store/editor-store";

export default function RemotionRender() {
  const [quality, setQuality] = useState<"draft" | "good" | "best">("draft");
  const tracks = useEditorStore((s) => s.tracks);
  const fps = useEditorStore((s) => s.fps);
  const duration = useEditorStore((s) => s.duration);

  const qSettings = {
    draft: { width: 640, height: 360 },
    good: { width: 1280, height: 720 },
    best: { width: 1920, height: 1080 },
  };

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const q = qSettings[quality];

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        {(["draft", "good", "best"] as const).map((q) => (
          <button key={q} onClick={() => setQuality(q)}
            className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
              quality === q ? "border-editor-accent bg-editor-accent/10 text-editor-accent" : "border-editor-glass-border text-muted-foreground"
            }`}
          >
            {q.charAt(0).toUpperCase() + q.slice(1)} ({qSettings[q].width}x{qSettings[q].height})
          </button>
        ))}
      </div>
      <div className="rounded overflow-hidden border border-editor-glass-border bg-black/40" style={{ aspectRatio: "16/9", maxHeight: 160 }}>
        <Player
          component={Composition}
          inputProps={{ tracks, width: q.width, height: q.height, fps }}
          durationInFrames={totalFrames}
          compositionWidth={q.width}
          compositionHeight={q.height}
          fps={fps}
          controls
          style={{ width: "100%", height: "auto" }}
        />
      </div>
    </div>
  );
}
