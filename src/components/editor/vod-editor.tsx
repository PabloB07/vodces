"use client";

import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEditorStore } from "@/store/editor-store";
import { useAutosave } from "@/hooks/use-autosave";
import { AlertCircle, LoaderCircle } from "lucide-react";

import Toolbar from "@/components/editor/toolbar";
import Timeline from "@/components/editor/timeline";
import EditorPlayer from "@/components/editor/player";
import AssetLibrary from "@/components/editor/asset-library";
import PropertiesPanel from "@/components/editor/properties-panel";
import BottomBar from "@/components/editor/bottom-bar";

const ExportDialog = lazy(() => import("@/components/editor/export-dialog"));
const CanvasOverlay = lazy(() => import("@/components/editor/panels/canvas-overlay"));

const VIDEO_UUID_PATTERN = /^[A-Za-z0-9-]{8,80}$/;

type Props = { defaultStreamer: string };
type VodItem = { id: number; videoUuid: string; title: string; durationMs: number | null; };

export default function VodEditor({ defaultStreamer }: Props) {
  const searchParams = useSearchParams();
  const rawUuid = searchParams.get("uuid");
  const videoUuid = useMemo(() => {
    if (!rawUuid) return null;
    const n = rawUuid.trim();
    return VIDEO_UUID_PATTERN.test(n) ? n : null;
  }, [rawUuid]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setDuration = useEditorStore((s) => s.setDuration);
  const addClip = useEditorStore((s) => s.addClip);
  const showLeftPanel = useEditorStore((s) => s.showLeftPanel);
  const showRightPanel = useEditorStore((s) => s.showRightPanel);
  const isCropMode = useEditorStore((s) => s.isCropMode);

  useAutosave();

  useEffect(() => {
    if (!videoUuid) {
      setLoading(false);
      setError("No valid VOD UUID. Open editing from Home.");
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const [streamerRes, sourceRes] = await Promise.all([
          fetch(`/api/kick/streamer/${defaultStreamer}`),
          fetch(`/api/kick/video/${videoUuid}`),
        ]);
        if (!streamerRes.ok || !sourceRes.ok) throw new Error("Failed to load VOD data");
        const streamerData = await streamerRes.json();
        const sourceData = await sourceRes.json();
        const vod = (streamerData.vods || []).find((v: VodItem) => v.videoUuid === videoUuid);
        if (!vod) throw new Error("VOD not found");

        const durSec = Math.max(1, Math.floor((vod.durationMs || 60000) / 1000));
        if (!sourceData.sourceUrl) throw new Error("Source URL not available from Kick API");
        const proxiedUrl = `/api/kick/media?u=${encodeURIComponent(sourceData.sourceUrl)}`;

        setDuration(durSec);
        addClip("track-video", {
          type: "video", name: vod.title.slice(0, 40), start: 0, end: durSec,
          src: proxiedUrl, color: "#3b82f6", props: {},
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load editor");
      }
      if (!cancelled) setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [defaultStreamer, videoUuid, setDuration, addClip]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading editor...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background selection:bg-purple-500/20">
      <Toolbar streamerSlug={defaultStreamer} />

      <div className="flex flex-1 min-h-0">
        {showLeftPanel && (
          <div className="w-56 shrink-0 border-r border-editor-glass-border hidden md:block">
            <AssetLibrary streamerSlug={defaultStreamer} videoUuid={videoUuid || undefined} />
          </div>
        )}

        <div className="relative flex flex-1 flex-col min-w-0">
          <div className="flex-1 relative flex items-center justify-center p-2 bg-black/60">
            {isCropMode && (
              <Suspense fallback={null}>
                <div className="absolute inset-0 z-10">
                  <CanvasOverlay />
                </div>
              </Suspense>
            )}
            <EditorPlayer />
          </div>
          <div className="h-40 shrink-0">
            <Timeline />
          </div>
        </div>

        {showRightPanel && (
          <div className="w-56 shrink-0 border-l border-editor-glass-border hidden md:block">
            <PropertiesPanel />
          </div>
        )}
      </div>

      <BottomBar />
      <Suspense fallback={null}><ExportDialog /></Suspense>
    </div>
  );
}
