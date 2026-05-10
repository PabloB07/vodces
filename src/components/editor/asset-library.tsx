"use client";

import { useState, useEffect } from "react";
import { useEditorStore } from "@/store/editor-store";
import type { VodItem } from "@/types/editor";
import { Film, Clock, Eye, LoaderCircle, Search } from "lucide-react";

type Props = {
  streamerSlug: string;
  videoUuid?: string;
};

export default function AssetLibrary({ streamerSlug, videoUuid }: Props) {
  const [vods, setVods] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const addClip = useEditorStore((s) => s.addClip);
  const setDuration = useEditorStore((s) => s.setDuration);
  const pushUndo = useEditorStore((s) => s.pushUndo);

  useEffect(() => {
    if (!videoUuid) {
      setLoading(false);
      return;
    }
    const run = async () => {
      try {
        const res = await fetch(`/api/kick/streamer/${streamerSlug}`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setVods(data.vods || []);
      } catch { /* silent */ }
      setLoading(false);
    };
    run();
  }, [streamerSlug, videoUuid]);

  const addVodToTimeline = (vod: VodItem) => {
    pushUndo();
    const durSec = Math.max(1, Math.floor((vod.durationMs || 60000) / 1000));
    const proxiedUrl = `/api/kick/media?u=${encodeURIComponent(`https://kick.com/${streamerSlug}/video/${vod.videoUuid}/source`)}`;
    addClip("track-video", {
      type: "video",
      name: vod.title.slice(0, 30),
      start: 0,
      end: durSec,
      src: proxiedUrl,
      color: "#3b82f6",
      props: {},
    });
    const current = useEditorStore.getState().duration;
    setDuration(Math.max(current, durSec));
  };

  const filtered = search
    ? vods.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()))
    : vods;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <LoaderCircle className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-editor-panel-bg">
      <div className="p-2 border-b border-editor-glass-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search VODs..."
            className="w-full bg-black/30 border border-editor-glass-border rounded pl-6 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-editor-accent"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground text-center">No VODs found</p>
        ) : (
          filtered.map((vod) => (
            <button
              key={vod.id}
              onClick={() => addVodToTimeline(vod)}
              className="w-full flex gap-2 p-2 border-b border-editor-glass-border/30 hover:bg-white/[0.04] text-left transition-colors"
            >
              <div className="w-16 h-9 rounded bg-black/50 shrink-0 overflow-hidden">
                {vod.thumbnailUrl ? (
                  <img src={vod.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full"><Film className="h-4 w-4 text-muted-foreground" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium truncate text-foreground">{vod.title}</p>
                <div className="flex items-center gap-2 text-[9px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{Math.floor((vod.durationMs || 0) / 60000)}m</span>
                  <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{(vod.views || 0).toLocaleString()}</span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
