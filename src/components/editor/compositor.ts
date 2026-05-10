"use client";

import type { Track } from "@/types/editor";

const IMAGE_CACHE = new Map<string, HTMLImageElement>();

function getImage(src: string): HTMLImageElement {
  let img = IMAGE_CACHE.get(src);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    IMAGE_CACHE.set(src, img);
  }
  return img;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  tracks: Track[],
  currentTime: number,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const activeClips = tracks
    .flatMap((t) => (t.visible ? t.clips : []))
    .filter((c) => currentTime >= c.start && currentTime < c.end);

  const zOrder: Record<string, number> = {
    video: 0,
    audio: 1,
    image: 2,
    gif: 3,
    text: 4,
    overlay: 5,
    effect: 6,
  };
  activeClips.sort((a, b) => (zOrder[a.type] ?? 5) - (zOrder[b.type] ?? 5));

  for (const clip of activeClips) {
    if (clip.type === "video" && video) {
      ctx.drawImage(video, 0, 0, width, height);
    }

    if (clip.type === "text") {
      const text = (clip.props?.text as string) || "";
      const size = (clip.props?.fontSize as number) || 48;
      const color = (clip.props?.color as string) || "#ffffff";
      const bg = (clip.props?.bgColor as string) || "rgba(0,0,0,0.5)";

      ctx.font = `bold ${size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lines = text.split("\n");
      const lineHeight = size * 1.3;
      const totalHeight = lines.length * lineHeight;
      const startY = height / 2 - totalHeight / 2 + lineHeight / 2;

      for (let i = 0; i < lines.length; i++) {
        const y = startY + i * lineHeight;
        const metrics = ctx.measureText(lines[i]);
        const pad = size * 0.4;
        const bx = width / 2 - metrics.width / 2 - pad;
        const by = y - size / 2 - pad / 2;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(bx, by, metrics.width + pad * 2, size + pad, size * 0.15);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.fillText(lines[i], width / 2, y);
      }
    }

    if (clip.type === "image" && clip.src) {
      try {
        ctx.drawImage(getImage(clip.src), 0, 0, width, height);
      } catch {
        // image not loaded yet
      }
    }

    if (clip.type === "effect") {
      const effectType = clip.props?.effectType as string;
      const localTime = currentTime - clip.start;
      if (effectType === "particles") {
        const count = (clip.props?.count as number) || 30;
        const color = (clip.props?.color as string) || "#a855f7";
        const speed = (clip.props?.speed as number) || 1;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < count; i++) {
          const px = (Math.sin(localTime * speed * 2 + i * 1.7) * 0.5 + 0.5) * width;
          const py = (Math.cos(localTime * speed * 1.3 + i * 2.3) * 0.5 + 0.5) * height;
          const r = 2 + Math.sin(localTime + i) * 1.5;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (effectType === "glow") {
        const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.6);
        gradient.addColorStop(0, `hsla(${(localTime * 30) % 360}, 80%, 60%, 0.3)`);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
    }

    if (clip.type === "overlay") {
      const shape = clip.props?.shape as string;
      const fill = (clip.props?.fill as string) || "#a855f7";
      const ox = (clip.props?.offsetX as number) || 0;
      const oy = (clip.props?.offsetY as number) || 0;
      const sw = (clip.props?.shapeWidth as number) || 100;
      const sh = (clip.props?.shapeHeight as number) || 100;

      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.6;
      if (shape === "rect") {
        ctx.fillRect(ox, oy, sw, sh);
      } else if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(ox + sw / 2, oy + sh / 2, sw / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "triangle") {
        ctx.beginPath();
        ctx.moveTo(ox + sw / 2, oy);
        ctx.lineTo(ox + sw, oy + sh);
        ctx.lineTo(ox, oy + sh);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}
