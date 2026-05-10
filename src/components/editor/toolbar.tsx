"use client";

import { useEditorStore } from "@/store/editor-store";
import { useCallback } from "react";
import { ArrowLeft, Crop, Film, Scissors } from "lucide-react";
import Link from "next/link";

type Props = {
  streamerSlug: string;
};

export default function Toolbar({ streamerSlug }: Props) {
  const setShowExportDialog = useEditorStore((s) => s.setShowExportDialog);
  const isCropMode = useEditorStore((s) => s.isCropMode);
  const setCropMode = useEditorStore((s) => s.setCropMode);
  const currentTime = useEditorStore((s) => s.currentTime);
  const splitClip = useEditorStore((s) => s.splitClip);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const tracks = useEditorStore((s) => s.tracks);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  const handleSplit = useCallback(() => {
    if (selectedClipIds.length === 1) {
      const clipId = selectedClipIds[0];
      for (const track of tracks) {
        if (track.clips.find((c) => c.id === clipId)) {
          pushUndo();
          splitClip(track.id, clipId, currentTime);
          break;
        }
      }
    }
  }, [selectedClipIds, tracks, currentTime, pushUndo, splitClip]);

  return (
    <header className="flex items-center justify-between gap-2 border-b border-editor-glass-border bg-card/95 px-4 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <ButtonLink href="/"><ArrowLeft className="mr-1 h-4 w-4" />Home</ButtonLink>
        <Badge>{streamerSlug}</Badge>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={handleSplit} disabled={selectedClipIds.length !== 1}
          className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-editor-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30">
          <Scissors className="h-3.5 w-3.5" /> Split
        </button>
        <button onClick={() => setCropMode(!isCropMode)}
          className={`inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border ${isCropMode ? "bg-editor-accent text-black border-editor-accent" : "border-editor-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5"}`}>
          <Crop className="h-3.5 w-3.5" /> Crop
        </button>
        <button onClick={() => setShowExportDialog(true)}
          className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md bg-editor-accent text-black hover:bg-editor-accent/80">
          <Film className="h-3.5 w-3.5" /> Export
        </button>
      </div>
    </header>
  );
}

function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center h-7 px-2 text-xs rounded-md border border-editor-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5">
      {children}
    </Link>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-editor-accent text-black">
      {children}
    </span>
  );
}
