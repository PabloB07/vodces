# vodces

App web de **Kick VODs** para el streamer **elcesarlive**, construida con **Next.js 16 + TypeScript + Tailwind + shadcn/ui**.

Usa endpoints `GET` públicos de Kick (sin OAuth) para:

- Mostrar live actual + VODs recientes.
- Mostrar mejores momentos (clips) con paginación.
- Editar VOD en ruta dedicada con trimmer.
- Previsualizar el recorte en paralelo.
- Descargar recorte en `m3u8` o `mp4`.

## Stack

- Next.js `16.1.6`
- React `19`
- TypeScript
- Tailwind CSS `v4`
- shadcn/ui + Radix
- `hls.js` + `video.js`
- `ffmpeg-static` (export MP4 en servidor)

## Inicio rápido

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Rutas principales

- `/` Home: live + VODs + best moments.
- `/vod/edit?uuid=<videoUuid>&start=<sec>&end=<sec>` editor full del VOD.
- `/moment/view?src=<m3u8>&title=<texto>` visor externo de momentos.

## Endpoints API internos

- `GET /api/kick/streamer/[slug]`
- `GET /api/kick/video/[uuid]`
- `GET /api/kick/media?u=<https-url>`
- `GET /api/kick/export/m3u8?u=<https-url>&start=<sec>&end=<sec>&name=<file>`
- `GET /api/kick/export/mp4?u=<https-url>&start=<sec>&end=<sec>&name=<file>`

## Flujo de edición

- Selecciona VOD desde Home y abre `Editar VOD`.
- Ajusta inicio/fin con trimmer o inputs.
- Reproduce la vista previa del recorte (loop opcional y calidad seleccionable).
- Descarga el tramo en `m3u8` o `mp4`.

## Límites actuales

- Export `mp4`: máximo `900s` por archivo.
- Export `m3u8`: máximo `43200s` (12h).
- El origen está fijado al canal `elcesarlive`.

## Seguridad aplicada

- Validación estricta de `slug`, `uuid`, `start`, `end`.
- Solo URLs `https` y hosts permitidos de Kick/CDN.
- Bloqueo de destinos locales/privados para evitar SSRF.
- Proxy de media con reescritura controlada de playlists HLS.
- Sanitización de nombre de archivo de descarga.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```
