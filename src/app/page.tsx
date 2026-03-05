import KickVodPlayer from "@/components/kick-vod-player";
import { STREAMER_SLUG } from "@/lib/kick";

export default function Home() {
  return <KickVodPlayer defaultStreamer={STREAMER_SLUG} />;
}
