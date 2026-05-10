"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;

  ffmpeg = new FFmpeg();

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return ffmpeg;
}

export type EncodeOptions = {
  inputUrl: string;
  format: "mp4" | "webm";
  startTime: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
};

export async function transcodeSegment(options: EncodeOptions): Promise<Uint8Array> {
  const { inputUrl, format, startTime, duration, width, height, fps } = options;
  const ff = await getFFmpeg();

  const inputName = "input.mp4";
  const outputName = `output.${format}`;

  const inputData = await fetchFile(inputUrl);
  await ff.writeFile(inputName, inputData);

  const codec = format === "webm" ? "libvpx-vp9" : "libx264";
  const ext = format === "webm" ? "webm" : "mp4";

  await ff.exec([
    "-i", inputName,
    "-ss", String(startTime),
    "-t", String(duration),
    "-vf", `scale=${width}:${height}`,
    "-r", String(fps),
    "-c:v", codec,
    "-preset", "ultrafast",
    "-y",
    outputName,
  ]);

  const data = await ff.readFile(outputName);
  return data as unknown as Uint8Array;
}

export async function createDownloadLink(data: Uint8Array, filename: string) {
  const blob = new Blob([data as BlobPart], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
