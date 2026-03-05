import { NextResponse } from "next/server";

import { getKickVideoSource, sanitizeVideoUuid } from "@/lib/kick";

type RouteContext = {
  params: Promise<{ uuid: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { uuid: rawUuid } = await params;

  let uuid: string;
  try {
    uuid = sanitizeVideoUuid(rawUuid);
  } catch {
    return NextResponse.json(
      { error: "Invalid video UUID." },
      { status: 400 },
    );
  }

  const data = await getKickVideoSource(uuid);
  if (!data.sourceUrl) {
    return NextResponse.json(
      {
        error: "Video source unavailable from server origin.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
    },
  });
}
