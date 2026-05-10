"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { Plus, Trash2 } from "lucide-react";

const STYLES = [
  { id: "classic", label: "Classic", style: "font-sans text-white" },
  { id: "neon", label: "Neon", style: "font-bold text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]" },
  { id: "typewriter", label: "Typewriter", style: "font-mono text-green-400" },
  { id: "bounce", label: "Bounce", style: "font-extrabold text-yellow-300 animate-bounce" },
];

export default function CaptionsPanel() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState("classic");
  const [fontSize, setFontSize] = useState(48);
  const addClip = useEditorStore((s) => s.addClip);

  const addCaption = () => {
    if (!text.trim()) return;
    addClip("track-text", {
      type: "text",
      name: text.slice(0, 20),
      start: 0,
      end: 5,
      props: { text, fontSize, color: STYLES.find((s) => s.id === style)?.style || "#fff" },
    });
    setText("");
  };

  return (
    <div className="p-3 space-y-3">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Caption text..."
        className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-editor-accent"
        onKeyDown={(e) => e.key === "Enter" && addCaption()}
      />
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-muted-foreground">Size</label>
        <input type="range" min={24} max={96} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="flex-1 accent-editor-accent" />
        <span className="text-[10px] text-muted-foreground w-8">{fontSize}</span>
      </div>
      <div className="flex gap-1">
        {STYLES.map((s) => (
          <button key={s.id} onClick={() => setStyle(s.id)}
            className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
              style === s.id ? "border-editor-accent bg-editor-accent/10 text-editor-accent" : "border-editor-glass-border text-muted-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <button onClick={addCaption} disabled={!text.trim()}
        className="flex items-center justify-center gap-1 w-full py-1.5 text-xs rounded bg-editor-accent/20 text-editor-accent border border-editor-accent/30 hover:bg-editor-accent/30 disabled:opacity-30">
        <Plus className="h-3 w-3" /> Add Caption
      </button>
    </div>
  );
}
