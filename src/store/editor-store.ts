import { create } from "zustand";
import type { Track, TimelineClip, Keyframe, ExportSettings, TimelineState } from "@/types/editor";

let _id = 0;
export const genId = () => `el_${Date.now()}_${++_id}`;

export type EditorStore = {
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  zoom: number;
  snapEnabled: boolean;
  selectedClipIds: string[];
  fps: number;

  showLeftPanel: boolean;
  showRightPanel: boolean;

  exportSettings: ExportSettings;
  showExportDialog: boolean;

  keyframes: Keyframe[];
  isCropMode: boolean;

  undoStack: TimelineState[];
  redoStack: TimelineState[];

  setCurrentTime: (t: number) => void;
  setIsPlaying: (v: boolean) => void;
  setDuration: (d: number) => void;
  setZoom: (z: number) => void;
  setSnapEnabled: (v: boolean) => void;
  setSelectedClipIds: (ids: string[]) => void;
  setFps: (fps: number) => void;

  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setShowExportDialog: (v: boolean) => void;
  updateExportSettings: (p: Partial<ExportSettings>) => void;
  setCropMode: (v: boolean) => void;

  addTrack: (t: Omit<Track, "clips">) => void;
  removeTrack: (id: string) => void;
  moveTrack: (from: number, to: number) => void;

  addClip: (trackId: string, c: Omit<TimelineClip, "id" | "trackId">) => string;
  removeClip: (trackId: string, clipId: string) => void;
  updateClip: (trackId: string, clipId: string, u: Partial<TimelineClip>) => void;
  moveClip: (fromTrack: string, clipId: string, toTrack: string, newStart: number) => void;
  splitClip: (trackId: string, clipId: string, at: number) => void;
  resizeClip: (trackId: string, clipId: string, start: number, end: number) => void;

  addKeyframe: (k: Omit<Keyframe, "id">) => string;
  removeKeyframe: (id: string) => void;
  getClipKeyframes: (clipId: string) => Keyframe[];

  snapshot: () => TimelineState;
  restore: (s: TimelineState) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
};

const defaultTracks: Track[] = [
  { id: "track-video", name: "Video", type: "video", clips: [], locked: false, visible: true },
  { id: "track-overlay", name: "Overlays", type: "overlay", clips: [], locked: false, visible: true },
  { id: "track-audio", name: "Audio", type: "audio", clips: [], locked: false, visible: true },
  { id: "track-text", name: "Text", type: "text", clips: [], locked: false, visible: true },
];

const defaultExport: ExportSettings = {
  format: "mp4",
  resolution: { width: 1920, height: 1080 },
  fps: 30,
  quality: 0.9,
  start: 0,
  end: 0,
};

function snapshotState(s: EditorStore): TimelineState {
  return {
    tracks: JSON.parse(JSON.stringify(s.tracks)),
    currentTime: s.currentTime,
    isPlaying: s.isPlaying,
    duration: s.duration,
    zoom: s.zoom,
    snapEnabled: s.snapEnabled,
    selectedClipIds: [...s.selectedClipIds],
    fps: s.fps,
  };
}

function restoreState(s: EditorStore, st: TimelineState) {
  s.tracks = st.tracks;
  s.currentTime = st.currentTime;
  s.isPlaying = st.isPlaying;
  s.duration = st.duration;
  s.zoom = st.zoom;
  s.snapEnabled = st.snapEnabled;
  s.selectedClipIds = st.selectedClipIds;
  s.fps = st.fps;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tracks: defaultTracks,
  currentTime: 0,
  isPlaying: false,
  duration: 0,
  zoom: 1,
  snapEnabled: true,
  selectedClipIds: [],
  fps: 30,

  showLeftPanel: true,
  showRightPanel: true,
  exportSettings: defaultExport,
  showExportDialog: false,
  keyframes: [],
  isCropMode: false,
  undoStack: [],
  redoStack: [],

  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(10, z)) }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setSelectedClipIds: (ids) => set({ selectedClipIds: ids }),
  setFps: (fps) => set({ fps }),

  toggleLeftPanel: () => set((s) => ({ showLeftPanel: !s.showLeftPanel })),
  toggleRightPanel: () => set((s) => ({ showRightPanel: !s.showRightPanel })),
  setShowExportDialog: (v) => set({ showExportDialog: v }),
  updateExportSettings: (p) => set((s) => ({ exportSettings: { ...s.exportSettings, ...p } })),
  setCropMode: (v) => set({ isCropMode: v }),

  addTrack: (t) => set((s) => ({
    tracks: [...s.tracks, { ...t, clips: [] }],
  })),
  removeTrack: (id) => set((s) => ({
    tracks: s.tracks.filter((t) => t.id !== id),
  })),
  moveTrack: (from, to) => set((s) => {
    const tracks = [...s.tracks];
    const [removed] = tracks.splice(from, 1);
    tracks.splice(to, 0, removed);
    return { tracks };
  }),

  addClip: (trackId, c) => {
    const id = genId();
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, { ...c, id, trackId }] } : t
      ),
    }));
    return id;
  },
  removeClip: (trackId, clipId) => set((s) => ({
    tracks: s.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
    ),
    selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId),
  })),
  updateClip: (trackId, clipId, u) => set((s) => ({
    tracks: s.tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...u } : c)) }
        : t
    ),
  })),
  moveClip: (fromTrack, clipId, toTrack, newStart) => set((s) => {
    const source = s.tracks.find((t) => t.id === fromTrack);
    const clip = source?.clips.find((c) => c.id === clipId);
    if (!clip) return s;
    const dur = clip.end - clip.start;
    return {
      tracks: s.tracks.map((t) => {
        if (t.id === fromTrack) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
        if (t.id === toTrack) return { ...t, clips: [...t.clips, { ...clip, trackId: toTrack, start: newStart, end: newStart + dur }] };
        return t;
      }),
    };
  }),
  splitClip: (trackId, clipId, at) => set((s) => {
    const track = s.tracks.find((t) => t.id === trackId);
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!clip || at <= clip.start || at >= clip.end) return s;
    const newId = genId();
    return {
      tracks: s.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: [
                ...t.clips.filter((c) => c.id !== clipId),
                { ...clip, end: at },
                { ...clip, id: newId, start: at },
              ].sort((a, b) => a.start - b.start),
            }
          : t
      ),
    };
  }),
  resizeClip: (trackId, clipId, start, end) => set((s) => ({
    tracks: s.tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, start, end } : c)) }
        : t
    ),
  })),

  addKeyframe: (k) => {
    const id = genId();
    set((s) => ({ keyframes: [...s.keyframes, { ...k, id }] }));
    return id;
  },
  removeKeyframe: (id) => set((s) => ({ keyframes: s.keyframes.filter((k) => k.id !== id) })),
  getClipKeyframes: (clipId) => get().keyframes.filter((k) => k.clipId === clipId),

  snapshot: () => snapshotState(get()),
  restore: (st) => set(() => {
    const s = { ...get() };
    restoreState(s, st);
    return {
      tracks: s.tracks,
      currentTime: s.currentTime,
      isPlaying: false,
      duration: s.duration,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      selectedClipIds: s.selectedClipIds,
      fps: s.fps,
    };
  }),
  pushUndo: () => set((s) => ({
    undoStack: [...s.undoStack.slice(-49), snapshotState(s)],
    redoStack: [],
  })),
  undo: () => set((s) => {
    if (s.undoStack.length === 0) return s;
    const prev = s.undoStack[s.undoStack.length - 1];
    const current = snapshotState(s);
    restoreState(s, prev);
    return {
      tracks: s.tracks,
      currentTime: s.currentTime,
      isPlaying: false,
      duration: s.duration,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      selectedClipIds: s.selectedClipIds,
      fps: s.fps,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, current],
    };
  }),
  redo: () => set((s) => {
    if (s.redoStack.length === 0) return s;
    const next = s.redoStack[s.redoStack.length - 1];
    const current = snapshotState(s);
    restoreState(s, next);
    return {
      tracks: s.tracks,
      currentTime: s.currentTime,
      isPlaying: false,
      duration: s.duration,
      zoom: s.zoom,
      snapEnabled: s.snapEnabled,
      selectedClipIds: s.selectedClipIds,
      fps: s.fps,
      undoStack: [...s.undoStack, current],
      redoStack: s.redoStack.slice(0, -1),
    };
  }),
}));
