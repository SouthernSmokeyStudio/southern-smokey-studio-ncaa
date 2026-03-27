// /api/sss/season-stats
// HTTP wrapper around seasonStatsAdapter.fetchSeasonStats.
// The slate route imports fetchSeasonStats directly (no internal HTTP call).
// This endpoint exists for debugging and cache inspection only.
//
// Cache: 4-hour TTL managed inside seasonStatsAdapter (module-level singleton).

import { fetchSeasonStats } from "@/lib/adapters/seasonStatsAdapter";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year") ?? "2026";

  if (!/^\d{4}$/.test(year)) {
    return Response.json(
      { status: "error", error: "year must be a 4-digit integer" },
      { status: 400 }
    );
  }

  try {
    const stats = await fetchSeasonStats(year);
    const count = Object.keys(stats).length;
    return Response.json({ status: "ok", year, count, stats });
  } catch (err) {
    console.error("[season-stats route]", err);
    return Response.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
