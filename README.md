# vodces

App web de **Kick VODs** para el streamer **moaigr**, construida con **Next.js 16 + TypeScript + Tailwind + shadcn/ui**.

Usa endpoints `GET` públicos de Kick (sin OAuth).

## Stack

- Next.js `16.1.6` · React `19` · TypeScript · Tailwind CSS `v4`
- shadcn/ui + Radix · `hls.js` · `video.js` · `ffmpeg-static`
- `@twick/studio` (VideoEditor, Timeline, LivePlayer)
- `zustand` · `framer-motion` · `gsap` · `konva` · `react-konva`
- `remotion` · `@ffmpeg/ffmpeg` (FFmpeg.wasm)
- `three` · `@react-three/fiber` · `@react-three/drei`
- `lottie-react` · `@tsparticles/react`

## Features

### VOD Editor (`/vod/edit?uuid=...`)
Editor full CapCut/Premiere-style con 4 paneles:

- **Left Panel** — Asset Library: lista de VODs reales desde la API de Kick
- **Center** — Video preview + timeline con Twick
- **Right Panel** — 3 tabs: Clip (recorte/nudge/presets), Properties (transform, zoom, snap, opacidad, keyframes), Effects (quick actions)
- **Bottom Bar** — 8 tabs: Tracks, Transitions, Captions, Animations (GSAP), 3D (R3F), Lottie, Particles, Render

### Capacidades

| Feature | Estado |
|---------|--------|
| Recorte con trim/nudge/presets | ✅ |
| Multi-track drag & drop | ✅ |
| Split en playhead | ✅ |
| Crop mode con Konva overlay | ✅ |
| Keyframes (posición, opacidad, rotación, escala) | ✅ |
| Transitions (crossfade, wipe, dissolve, slide, zoom) | ✅ |
| Animated captions con estilos | ✅ |
| GSAP animation presets (10 tipos) | ✅ |
| Escena 3D con R3F | ✅ |
| Animaciones Lottie | ✅ |
| Particle effects (tsParticles) | ✅ |
| Canvas overlay (rect, circle, arrow, text, draw) | ✅ |
| Export MP4/WebM (server-side + client-side FFmpeg.wasm) | ✅ |
| Remotion render pipeline | ✅ |
| Keyboard shortcuts (Space, Cmd+Z/Shift+Z, Cmd+E, Cmd+S, Split, zoom) | ✅ |
| Autosave a localStorage | ✅ |
| Undo/Redo con snapshots | ✅ |
| Lazy loading (dynamic imports) | ✅ |
| Responsive layout con paneles colapsables | ✅ |
| GPU-friendly CSS (will-change, transform) | ✅ |
| Tema dark purple gaming con glassmorphism | ✅ |

### Shortcuts

- `Space` — Play/Pause
- `Cmd+Z` — Undo
- `Cmd+Shift+Z` — Redo
- `Cmd+E` — Export dialog
- `Cmd+S` — Mark saved
- `Cmd+Shift+S` — Split clip
- `+` / `-` — Zoom in/out
- `0` — Reset zoom
- `Delete` / `Backspace` — Clear history

## Rutas

- `/` — Home: live + VODs + best moments
- `/vod/edit?uuid=<uuid>` — Editor full
- `/moment/view?src=<m3u8>&title=<texto>` — Visor de momentos

## Endpoints API internos

- `GET /api/kick/streamer/[slug]`
- `GET /api/kick/video/[uuid]`
- `GET /api/kick/media?u=<https-url>`
- `GET /api/kick/export/m3u8?...`
- `GET /api/kick/export/mp4?...`

## Límites

- Export MP4: máximo 900s por archivo
- Export m3u8: máximo 43200s (12h)
- Canal fijado a `moaigr`

## Inicio rápido

```bash
npm install
npm run dev
```

Abrir `http://localhost:3000`.
