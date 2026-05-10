"use client";

export type ClipType = "video" | "audio" | "text" | "image" | "gif" | "effect" | "overlay";

export type TimelineClip = {
  id: string;
  type: ClipType;
  name: string;
  start: number;
  end: number;
  trackId: string;
  src?: string;
  color?: string;
  props: Record<string, unknown>;
};

export type TrackType = "video" | "audio" | "text" | "overlay";

export type Track = {
  id: string;
  name: string;
  type: TrackType;
  clips: TimelineClip[];
  locked: boolean;
  visible: boolean;
};

export type Keyframe = {
  id: string;
  clipId: string;
  property: string;
  time: number;
  value: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
};

export type Transition = {
  id: string;
  type: "crossfade" | "fade" | "dissolve" | "wipe" | "slide" | "zoom";
  duration: number;
};

export type ExportSettings = {
  format: "mp4" | "webm";
  resolution: { width: number; height: number };
  fps: number;
  quality: number;
  start: number;
  end: number;
};

export type EditorPanel = "assets" | "transitions" | "captions" | "animations";

export type TimelineState = {
  tracks: Track[];
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  zoom: number;
  snapEnabled: boolean;
  selectedClipIds: string[];
  fps: number;
};

export type VodItem = {
  id: number;
  videoUuid: string;
  title: string;
  createdAt: string | null;
  durationMs: number | null;
  views: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
  isLive?: boolean;
};

export type VideoSource = {
  videoUuid: string;
  sourceUrl: string;
  title: string | null;
  createdAt: string | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
  kickUrl: string;
};
