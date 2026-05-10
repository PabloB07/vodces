"use client";

import { useEditorStore } from "@/store/editor-store";
import { Settings2, Type, ArrowUpDown, Lock, Trash2 } from "lucide-react";

export default function PropertiesPanel() {
  const tracks = useEditorStore((s) => s.tracks);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const updateClip = useEditorStore((s) => s.updateClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const pushUndo = useEditorStore((s) => s.pushUndo);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const fps = useEditorStore((s) => s.fps);
  const setFps = useEditorStore((s) => s.setFps);

  const selectedClip = selectedClipIds.length === 1
    ? tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipIds[0])
    : null;

  return (
    <div className="flex flex-col h-full bg-editor-panel-bg overflow-y-auto">
      <div className="p-3 border-b border-editor-glass-border">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Settings2 className="h-3.5 w-3.5" /> Properties</h3>
      </div>

      <div className="p-3 space-y-4">
        <div>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1"><ArrowUpDown className="h-3 w-3" /> Zoom</label>
          <input type="range" min={0.1} max={5} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-editor-accent" />
          <span className="text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
        </div>

        <div>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1"><Type className="h-3 w-3" /> FPS</label>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground">
            <option value={24}>24</option><option value={25}>25</option><option value={30}>30</option><option value={60}>60</option>
          </select>
        </div>
      </div>

      {selectedClip && (
        <div className="border-t border-editor-glass-border p-3 space-y-3">
          <h4 className="flex items-center gap-1 text-[10px] font-medium text-editor-accent uppercase tracking-wider">
            <Lock className="h-3 w-3" /> {selectedClip.name}
          </h4>

          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Name</label>
            <input
              value={selectedClip.name}
              onChange={(e) => updateClip(selectedClip.trackId, selectedClip.id, { name: e.target.value })}
              className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-editor-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Start</label>
              <input type="number" value={Math.round(selectedClip.start * 100) / 100} step={0.1}
                onChange={(e) => { const v = Number(e.target.value); if (v < selectedClip.end) updateClip(selectedClip.trackId, selectedClip.id, { start: v }); }}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-editor-accent" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">End</label>
              <input type="number" value={Math.round(selectedClip.end * 100) / 100} step={0.1}
                onChange={(e) => { const v = Number(e.target.value); if (v > selectedClip.start) updateClip(selectedClip.trackId, selectedClip.id, { end: v }); }}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-editor-accent" />
            </div>
          </div>

          {selectedClip.type === "text" && (
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Text</label>
              <input
                value={(selectedClip.props?.text as string) || ""}
                onChange={(e) => updateClip(selectedClip.trackId, selectedClip.id, { props: { ...selectedClip.props, text: e.target.value } })}
                className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-editor-accent"
              />
            </div>
          )}

          <button onClick={() => { pushUndo(); removeClip(selectedClip.trackId, selectedClip.id); }}
            className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300">
            <Trash2 className="h-3 w-3" /> Delete clip
          </button>
        </div>
      )}
    </div>
  );
}
