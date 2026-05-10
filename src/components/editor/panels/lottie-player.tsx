"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import Lottie from "lottie-react";

const ANIMATIONS = [
  { id: "fire", url: "https://assets5.lottiefiles.com/packages/lf20_2ceaf8gv.json", label: "Fire" },
  { id: "confetti", url: "https://assets2.lottiefiles.com/packages/lf20_u8i5jqyq.json", label: "Confetti" },
  { id: "like", url: "https://assets8.lottiefiles.com/packages/lf20_kyqk8u5d.json", label: "Like" },
  { id: "loading", url: "https://assets9.lottiefiles.com/packages/lf20_wzvy7mwk.json", label: "Loading" },
];

export default function LottiePlayer() {
  const [active, setActive] = useState<string | null>(null);
  const addClip = useEditorStore((s) => s.addClip);
  const currentTime = useEditorStore((s) => s.currentTime);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const addLottie = (anim: typeof ANIMATIONS[number]) => {
    setActive(anim.id);
    pushUndo();
    addClip("track-overlay", {
      type: "overlay",
      name: `Lottie: ${anim.label}`,
      start: currentTime,
      end: currentTime + 3,
      props: { lottieUrl: anim.url, lottieId: anim.id },
    });
  };

  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-2">
        {ANIMATIONS.map((a) => (
          <button key={a.id} onClick={() => addLottie(a)}
            className={`py-1.5 text-[10px] rounded border transition-colors ${
              active === a.id ? "border-editor-accent bg-editor-accent/10 text-editor-accent" : "border-editor-glass-border text-muted-foreground hover:border-editor-accent/50"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      {active && (
        <p className="text-[10px] text-muted-foreground mt-2">Added to timeline at {formatTime(currentTime)}</p>
      )}
    </div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
