"use client";

import { useState, useRef, useCallback } from "react";
import { useEditorStore } from "@/store/editor-store";
import { Square, Circle, Trash2, Save } from "lucide-react";

type DrawElement = {
  id: string;
  shape: "rect" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
};

export default function CanvasOverlay() {
  const [elements, setElements] = useState<DrawElement[]>([]);
  const [tool, setTool] = useState<"rect" | "circle">("rect");
  const [color, setColor] = useState("#a855f7");
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const addClip = useEditorStore((s) => s.addClip);
  const currentTime = useEditorStore((s) => s.currentTime);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStartPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setIsDrawing(true);
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDrawing) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(startPos.x, e.clientX - rect.left);
    const y = Math.min(startPos.y, e.clientY - rect.top);
    const w = Math.abs(e.clientX - rect.left - startPos.x);
    const h = Math.abs(e.clientY - rect.top - startPos.y);
    setElements((prev) => [...prev, { id: `el-${Date.now()}`, shape: tool, x, y, width: Math.max(w, 10), height: Math.max(h, 10), fill: color }]);
    setIsDrawing(false);
  }, [isDrawing, tool, startPos, color]);

  const deleteElement = (id: string) => setElements((prev) => prev.filter((el) => el.id !== id));

  const saveToTimeline = () => {
    if (elements.length === 0) return;
    pushUndo();
    elements.forEach((el) => {
      addClip("track-overlay", {
        type: "overlay",
        name: `Shape: ${el.shape}`,
        start: currentTime,
        end: currentTime + 3,
        props: {
          shape: el.shape,
          fill: el.fill,
          offsetX: el.x,
          offsetY: el.y,
          shapeWidth: el.width,
          shapeHeight: el.height,
        },
      });
    });
    setElements([]);
  };

  const clearAll = () => setElements([]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 p-1 border-b border-editor-glass-border bg-black/60">
        <button onClick={() => setTool("rect")}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded ${tool === "rect" ? "bg-editor-accent/20 text-editor-accent" : "text-muted-foreground"}`}>
          <Square className="h-3.5 w-3.5" /> Rect
        </button>
        <button onClick={() => setTool("circle")}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded ${tool === "circle" ? "bg-editor-accent/20 text-editor-accent" : "text-muted-foreground"}`}>
          <Circle className="h-3.5 w-3.5" /> Circle
        </button>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-5 h-5 rounded cursor-pointer" />
        <div className="flex-1" />
        <button onClick={saveToTimeline} disabled={elements.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-editor-accent/20 text-editor-accent hover:bg-editor-accent/30 disabled:opacity-30">
          <Save className="h-3 w-3" /> Save
        </button>
        <button onClick={clearAll} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div ref={containerRef} className="flex-1 relative overflow-hidden cursor-crosshair bg-black/20"
        onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}
      >
        {elements.map((el) => (
          <div key={el.id}
            className="absolute border border-editor-accent/60 bg-editor-accent/10 group cursor-move"
            style={{
              left: el.x, top: el.y, width: el.width, height: el.height,
              borderRadius: el.shape === "circle" ? "50%" : undefined,
            }}
          >
            <button onClick={() => deleteElement(el.id)}
              className="absolute -top-2 -right-2 p-0.5 bg-red-500 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        {elements.length > 0 && (
          <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground bg-black/60 px-2 py-0.5 rounded">
            {elements.length} shape{elements.length > 1 ? "s" : ""} — click Save to add to timeline
          </div>
        )}
      </div>
    </div>
  );
}
