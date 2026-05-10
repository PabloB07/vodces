"use client";

import { useState, lazy, Suspense } from "react";
import { useEditorStore } from "@/store/editor-store";
import {
  Sparkles, Captions, Waves, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, LoaderCircle,
} from "lucide-react";

const TransitionsPanel = lazy(() => import("@/components/editor/panels/transitions-panel"));
const CaptionsPanel = lazy(() => import("@/components/editor/panels/captions-panel"));
const GsapPresets = lazy(() => import("@/components/editor/panels/gsap-presets"));
const R3FScene = lazy(() => import("@/components/editor/panels/r3f-scene"));
const LottiePlayer = lazy(() => import("@/components/editor/panels/lottie-player"));
const ParticlesEffect = lazy(() => import("@/components/editor/panels/particles-effect"));
const RemotionRender = lazy(() => import("@/components/editor/panels/remotion-render"));

type TabId = "transitions" | "captions" | "gsap" | "effects3d" | "lottie" | "particles" | "remotion";

const tabs: { id: TabId; label: string; icon: typeof Sparkles }[] = [
  { id: "transitions", label: "Transitions", icon: Waves },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "gsap", label: "Animations", icon: Sparkles },
  { id: "effects3d", label: "3D", icon: Sparkles },
  { id: "lottie", label: "Lottie", icon: Sparkles },
  { id: "particles", label: "Particles", icon: Sparkles },
  { id: "remotion", label: "Render", icon: Sparkles },
];

function Fallback() {
  return <div className="flex items-center justify-center h-24"><LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
}

export default function BottomBar() {
  const [active, setActive] = useState<TabId>("transitions");
  const toggleLeft = useEditorStore((s) => s.toggleLeftPanel);
  const toggleRight = useEditorStore((s) => s.toggleRightPanel);
  const showLeft = useEditorStore((s) => s.showLeftPanel);
  const showRight = useEditorStore((s) => s.showRightPanel);

  return (
    <div className="shrink-0 border-t border-editor-glass-border bg-editor-panel-bg">
      <div className="flex items-center justify-between overflow-x-auto">
        <div className="flex">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActive(id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-[10px] font-medium whitespace-nowrap transition-colors ${
                active === id ? "border-editor-accent text-editor-accent" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" />{label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 pr-2">
          <button onClick={toggleLeft} className="p-1 text-muted-foreground hover:text-foreground" title={showLeft ? "Hide assets" : "Show assets"}>
            {showLeft ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
          </button>
          <button onClick={toggleRight} className="p-1 text-muted-foreground hover:text-foreground" title={showRight ? "Hide properties" : "Show properties"}>
            {showRight ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto border-t border-editor-glass-border">
        <Suspense fallback={<Fallback />}>
          {active === "transitions" && <TransitionsPanel />}
          {active === "captions" && <CaptionsPanel />}
          {active === "gsap" && <GsapPresets />}
          {active === "effects3d" && <R3FScene />}
          {active === "lottie" && <LottiePlayer />}
          {active === "particles" && <ParticlesEffect />}
          {active === "remotion" && <RemotionRender />}
        </Suspense>
      </div>
    </div>
  );
}
