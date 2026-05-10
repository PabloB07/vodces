"use client";

import { AbsoluteFill, Sequence, Img, useCurrentFrame } from "remotion";
import type { Track } from "@/types/editor";

type CompositionProps = {
  tracks: Track[];
  width: number;
  height: number;
  fps: number;
};

function ClipRenderer({ clip, frame }: { clip: Track["clips"][number]; frame: number }) {
  if (clip.type === "image" && clip.src) {
    return (
      <AbsoluteFill>
        <Img src={clip.src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </AbsoluteFill>
    );
  }

  if (clip.type === "text") {
    const text = (clip.props?.text as string) || "Text";
    const size = (clip.props?.fontSize as number) || 48;
    const color = (clip.props?.color as string) || "#fff";
    return (
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size, color, fontWeight: 700, textShadow: "0 2px 8px rgba(0,0,0,0.8)", fontFamily: "sans-serif" }}>
          {text}
        </span>
      </AbsoluteFill>
    );
  }

  return null;
}

export default function Composition({ tracks, width, height, fps }: CompositionProps) {
  const frame = useCurrentFrame();
  const allClips = tracks.flatMap((t) => t.clips);

  return (
    <AbsoluteFill style={{ width, height }}>
      {allClips.map((clip) => {
        const startFrame = Math.round(clip.start * fps);
        const endFrame = Math.round(clip.end * fps);
        const duration = endFrame - startFrame;
        return (
          <Sequence key={clip.id} from={startFrame} durationInFrames={Math.max(1, duration)}>
            <ClipRenderer clip={clip} frame={frame} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
