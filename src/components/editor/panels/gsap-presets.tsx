"use client";

import { useState, useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editor-store";
import gsap from "gsap";

const PRESETS = [
  { id: "fade-in", label: "Fade In", props: { opacity: 0, y: 0 }, to: { opacity: 1, duration: 1 } },
  { id: "slide-up", label: "Slide Up", props: { opacity: 0, y: 50 }, to: { opacity: 1, y: 0, duration: 1 } },
  { id: "slide-left", label: "Slide Left", props: { opacity: 0, x: 100 }, to: { opacity: 1, x: 0, duration: 1 } },
  { id: "scale-in", label: "Scale In", props: { opacity: 0, scale: 0.5 }, to: { opacity: 1, scale: 1, duration: 1 } },
  { id: "rotate-in", label: "Rotate In", props: { opacity: 0, rotation: -90 }, to: { opacity: 1, rotation: 0, duration: 1 } },
  { id: "bounce", label: "Bounce", props: { opacity: 0, y: -80 }, to: { opacity: 1, y: 0, duration: 1.2, ease: "bounce.out" } },
  { id: "stagger", label: "Stagger", props: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0, duration: 0.6, stagger: 0.1 } },
  { id: "blur-in", label: "Blur In", props: { opacity: 0, filter: "blur(10px)" }, to: { opacity: 1, filter: "blur(0px)", duration: 1 } },
];

export default function GsapPresets() {
  const [selected, setSelected] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const tracks = useEditorStore((s) => s.tracks);
  const updateClip = useEditorStore((s) => s.updateClip);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const selectedClip = selectedClipIds.length === 1
    ? tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipIds[0])
    : null;

  useEffect(() => {
    if (!previewRef.current) return;
    gsap.set(previewRef.current, { opacity: 0, x: 0, y: 0, scale: 1, rotation: 0, filter: "blur(0px)" });
  }, []);

  const playPreset = (id: string) => {
    setSelected(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset || !previewRef.current) return;
    gsap.set(previewRef.current, preset.props as gsap.TweenVars);
    gsap.to(previewRef.current, { ...preset.to, delay: 0.1 } as gsap.TweenVars);

    if (!selectedClip) return;
    pushUndo();
    updateClip(selectedClip.trackId, selectedClip.id, {
      props: { ...selectedClip.props, animation: id },
    });
  };

  return (
    <div className="p-3">
      {!selectedClip && (
        <p className="text-[10px] text-muted-foreground mb-2">Select a clip on the timeline first</p>
      )}
      <div ref={previewRef} className="h-12 flex items-center justify-center rounded bg-editor-glass border border-editor-glass-border mb-3">
        <span className="text-sm font-bold text-editor-accent">Animation</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => playPreset(p.id)}
            className={`py-1.5 px-2 text-[10px] rounded border transition-colors ${
              selected === p.id
                ? "border-editor-accent bg-editor-accent/10 text-editor-accent"
                : "border-editor-glass-border text-muted-foreground hover:border-editor-accent/50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {!!selectedClip?.props?.animation && (
        <p className="text-[10px] text-editor-accent mt-2">
          Animation: {String(selectedClip.props.animation)}
        </p>
      )}
    </div>
  );
}
