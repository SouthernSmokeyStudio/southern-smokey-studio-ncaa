// ncaaStatsAdapter.ts
// Endpoint: GET /stats/basketball-men/d1/current/team/{statId}
// Season-level team stats (not game-level).
//
// PROVISIONAL — exact stat endpoint paths not confirmed via live API inspection.
// Fetch pattern and type signature are stubbed. Do not use in production until
// endpoint paths are verified and field names confirmed.
//
// Known statId examples (unconfirmed — do not build logic against these):
//   scoring, rebounding, assists, field-goal-pct, three-point-pct, etc.
//
// Fail closed: return null until endpoint is confirmed.

const BASE_URL = "https://ncaa-api.henrygd.me";

// ---------------------------------------------------------------------------
// Provisional type — fields unknown until live inspection
// ---------------------------------------------------------------------------

export interface NcaaStatRow {
  teamId: string;
  teamName: string;
  statValue: number;
  rank: number | null;
}

export interface NcaaSeasonStats {
  statId: string;
  season: string;
  rows: NcaaStatRow[];
}

// ---------------------------------------------------------------------------
// Main fetch function — PROVISIONAL STUB
// ---------------------------------------------------------------------------

export async function fetchNcaaSeasonStats(
  statId: string,
  season = "current"
): Promise<NcaaSeasonStats | null> {
  // PROVISIONAL: endpoint path format unconfirmed. Ping live API before
  // implementing parsing logic here.
  const url = `${BASE_URL}/stats/basketball-men/d1/${season}/team/${statId}`;

  console.warn(
    `[ncaaStatsAdapter] PROVISIONAL — endpoint not confirmed: ${url}`
  );

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.warn(
        `[ncaaStatsAdapter] HTTP ${res.status} for statId "${statId}" — endpoint may not exist`
      );
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn(
      `[ncaaStatsAdapter] fetch failed for statId "${statId}"`,
      err
    );
    return null;
  }

  // PROVISIONAL: field mapping is a placeholder.
  // Do not ship until field names are confirmed via live inspection.
  console.warn(
    "[ncaaStatsAdapter] response received but field mapping is unconfirmed — returning null until verified"
  );
  void data;
  return null;
}
