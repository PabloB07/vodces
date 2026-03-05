import VodFullEditor from "@/components/vod-full-editor";
import { STREAMER_SLUG } from "@/lib/kick";
import { Suspense } from "react";

export default function VodEditPage() {
  return (
    <Suspense fallback={null}>
      <VodFullEditor defaultStreamer={STREAMER_SLUG} />
    </Suspense>
  );
}
