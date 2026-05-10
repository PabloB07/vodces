"use client";

import { Canvas } from "@react-three/fiber";
import { Text3D, OrbitControls, Center } from "@react-three/drei";
import { Suspense, useState } from "react";
import { useEditorStore } from "@/store/editor-store";
import { Plus } from "lucide-react";

export default function R3FScene() {
  const [text, setText] = useState("moaigr");
  const addClip = useEditorStore((s) => s.addClip);
  const currentTime = useEditorStore((s) => s.currentTime);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const addToTimeline = () => {
    pushUndo();
    addClip("track-overlay", {
      type: "text",
      name: `3D: ${text}`,
      start: currentTime,
      end: currentTime + 4,
      props: { text, fontSize: 48, color: "#a855f7", is3d: true },
    });
  };

  return (
    <div className="p-3 space-y-2">
      <div className="h-32 w-full rounded bg-black overflow-hidden">
        <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[5, 5, 5]} intensity={1} color="#a855f7" />
          <pointLight position={[-5, -5, 5]} intensity={0.5} color="#3b82f6" />
          <Suspense fallback={null}>
            <Center>
              <Text3D font="/fonts/Inter_Bold.json" size={0.5} height={0.1} curveSegments={12}>
                {text}
                <meshStandardMaterial color="#a855f7" />
              </Text3D>
            </Center>
          </Suspense>
          <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={2} />
        </Canvas>
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)}
        className="w-full bg-black/40 border border-editor-glass-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-editor-accent"
      />
      <button onClick={addToTimeline}
        className="flex items-center justify-center gap-1 w-full py-1.5 text-xs rounded bg-editor-accent/20 text-editor-accent border border-editor-accent/30 hover:bg-editor-accent/30">
        <Plus className="h-3 w-3" /> Add 3D Text to Timeline
      </button>
    </div>
  );
}
