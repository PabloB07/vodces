import { Suspense } from "react";

import MomentViewer from "@/components/moment-viewer";

export default function MomentViewPage() {
  return (
    <Suspense fallback={null}>
      <MomentViewer />
    </Suspense>
  );
}
