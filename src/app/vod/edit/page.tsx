import VodEditor from "@/components/editor/vod-editor";
import { STREAMER_SLUG } from "@/lib/kick";
import { Suspense } from "react";

export default function VodEditPage() {
  return (
    <Suspense fallback={null}>
      <VodEditor defaultStreamer={STREAMER_SLUG} />
    </Suspense>
  );
}
