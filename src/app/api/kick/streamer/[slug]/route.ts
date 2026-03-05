import { NextResponse } from "next/server";

import { getKickStreamerData, sanitizeStreamerSlug } from "@/lib/kick";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug: rawSlug } = await params;

  let slug: string;
  try {
    slug = sanitizeStreamerSlug(rawSlug);
  } catch {
    return NextResponse.json(
      { error: "Invalid streamer slug." },
      { status: 400 },
    );
  }

  const data = await getKickStreamerData(slug);
  if (!data.streamer) {
    return NextResponse.json(
      {
        streamer: {
          id: null,
          slug,
          username: slug,
          profileImageUrl: null,
          bannerImageUrl: null,
        },
        vods: [],
        moments: [],
        fetchedAt: new Date().toISOString(),
        errors: [
          `Streamer ${slug} unavailable from server origin.`,
          ...data.errors,
        ].slice(0, 4),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
    },
  });
}
