// lib/adapters/seasonStatsAdapter.ts
// Fetches season-level team stats from the henrygd NCAA stats endpoints.
//
// Endpoints (basketball-men/d1/{year}/team/{id}):
//   145 — Scoring Offense → PPG  (field name inferred from API naming patterns; verified via console.warn)
//   148 — Field Goal %    → FGM, FGA, FG%
//   150 — Free Throw %    → FT, FTA, FT%
//   151 — Rebound Margin  → RPG, OPP RPG, REB MAR
//   152 — Three Point %   → 3FG, 3FGA, 3FG%
//   214 — Blocks/Game     → BLKS, BKPG
//   215 — Steals/Game     → ST, STPG
//   216 — Assists/Game    → AST, APG
//   217 — Turnovers/Game  → TO, TOPG
//
// Join: stats "Team" display name → /schools-index name → slug (= seoname).
//   Known mismatches patched via STATS_NAME_OVERRIDES.
//
// Fail-closed: a team missing any of the 8 endpoints is excluded from output.
//   Callers receive null for that seoname when looking up season stats.
//
// Cache: 4-hour module-level cache per year. Shared between the HTTP route
//   and the slate route (direct import — no internal HTTP round-trip).

import type { SeasonTeamStats } from "@/lib/types";

const NCAA_BASE = "https://ncaa-api.henrygd.me";

// ---------------------------------------------------------------------------
// Known stat-page display name → seoname overrides.
// These names do not match the /schools-index name field.
// ---------------------------------------------------------------------------

const STATS_NAME_OVERRIDES: Record<string, string> = {
  "NC State": "north-carolina-st",
  "UConn":    "uconn",
};

// ---------------------------------------------------------------------------
// Stat endpoint IDs
// ---------------------------------------------------------------------------

const STAT_ENDPOINT_IDS = [145, 148, 150, 151, 152, 214, 215, 216, 217] as const;

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  stats: Record<string, SeasonTeamStats>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNum(val: unknown): number {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalize a stats endpoint display name to seoname format.
 * Used as a fallback when the schools-index lookup fails.
 *
 * Rules:
 *   lowercase → remove periods → remove apostrophes → remove parens → spaces→hyphens
 *
 * Examples:
 *   "Duke"          → "duke"
 *   "Michigan St."  → "michigan-st"
 *   "Florida"       → "florida"
 *   "St. Mary's (CA)" → "st-marys-ca"
 *   "Loyola (Ill.)" → "loyola-ill"
 *
 * NOTE: overrides in STATS_NAME_OVERRIDES take priority and will never reach this.
 * Schools-index lookup takes secondary priority. This function is the last resort.
 */
function normalizeDisplayName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")         // "St." → "st", "Ill." → "ill"
    .replace(/[''']/g, "")      // apostrophes: "St. Mary's" → "st marys"
    .replace(/[()]/g, "")       // parens: "Cal (Davis)" → "cal davis"
    .replace(/\s+/g, "-")       // spaces → hyphens
    .replace(/-+/g, "-")        // collapse consecutive hyphens
    .replace(/^-|-$/g, "");     // trim leading/trailing hyphens
}

/** Fetch all pages of a single stat endpoint. Returns flat array of row objects. */
async function fetchAllPages(
  endpointId: number,
  year: string
): Promise<Record<string, string>[]> {
  const url = `${NCAA_BASE}/stats/basketball-men/d1/${year}/team/${endpointId}`;

  let firstRes: Response;
  try {
    firstRes = await fetch(url);
  } catch (err) {
    console.warn(`[seasonStatsAdapter] fetch failed for endpoint ${endpointId}: ${err}`);
    return [];
  }
  if (!firstRes.ok) {
    console.warn(`[seasonStatsAdapter] HTTP ${firstRes.status} for endpoint ${endpointId}`);
    return [];
  }

  const firstData = await firstRes.json() as {
    pages?: number;
    data?: Record<string, string>[];
  };

  const rows: Record<string, string>[] = [...(firstData.data ?? [])];
  const totalPages = firstData.pages ?? 1;

  for (let page = 2; page <= totalPages; page++) {
    await delay(220); // stay well under 5 req/sec rate limit
    try {
      const pr = await fetch(`${url}?page=${page}`);
      if (!pr.ok) break;
      const pd = await pr.json() as { data?: Record<string, string>[] };
      rows.push(...(pd.data ?? []));
    } catch {
      break;
    }
  }

  return rows;
}

/** Build name → seoname lookup from /schools-index plus known overrides. */
async function buildNameToSeoname(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Overrides take priority — set first
  for (const [name, seoname] of Object.entries(STATS_NAME_OVERRIDES)) {
    map.set(name, seoname);
  }

  try {
    const res = await fetch(`${NCAA_BASE}/schools-index`);
    if (!res.ok) {
      console.warn(`[seasonStatsAdapter] schools-index HTTP ${res.status}`);
      return map;
    }
    const schools = await res.json() as Array<Record<string, string>>;
    for (const school of schools) {
      const name = school["name"];
      const slug = school["slug"];
      if (name && slug && !map.has(name)) {
        map.set(name, slug);
      }
    }
  } catch (err) {
    console.warn(`[seasonStatsAdapter] schools-index fetch failed: ${err}`);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main export — shared by the HTTP route and the slate route (direct import)
// ---------------------------------------------------------------------------

export async function fetchSeasonStats(
  year: string
): Promise<Record<string, SeasonTeamStats>> {
  // Cache hit
  const hit = cache.get(year);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.stats;
  }

  // Build name → seoname map
  const nameToSeoname = await buildNameToSeoname();

  // Fetch all 8 stat endpoints sequentially.
  // Each call handles its own pagination (pages 2-N with 220ms delay).
  // Add 400ms gap between endpoints so total request rate stays ~2/sec.
  const rowsByEndpoint: Record<number, Record<string, string>[]> = {};
  for (const id of STAT_ENDPOINT_IDS) {
    rowsByEndpoint[id] = await fetchAllPages(id, year);
    await delay(400);
  }

  // Index each endpoint's rows by seoname.
  // Resolution order:
  //   1. STATS_NAME_OVERRIDES (highest priority — known display-name mismatches)
  //   2. /schools-index name → slug lookup
  //   3. normalizeDisplayName() fallback — lowercase + periods/spaces normalized
  // Every team gets a key; resolution mismatches surface as null stats at lookup time.
  const byId: Record<number, Map<string, Record<string, string>>> = {};
  let normalizedFallbackCount = 0;
  for (const id of STAT_ENDPOINT_IDS) {
    byId[id] = new Map();
    for (const row of rowsByEndpoint[id]) {
      const teamName = row["Team"];
      if (!teamName) continue;
      const fromIndex = nameToSeoname.get(teamName);
      let seoname: string;
      if (fromIndex) {
        seoname = fromIndex;
      } else {
        seoname = normalizeDisplayName(teamName);
        if (id === STAT_ENDPOINT_IDS[0]) normalizedFallbackCount++;
      }
      byId[id].set(seoname, row);
    }
  }
  if (normalizedFallbackCount > 0) {
    console.warn(
      `[seasonStatsAdapter] ${normalizedFallbackCount} teams not in schools-index — ` +
      `seonames derived via normalizeDisplayName(). Check overrides if any games remain blocked.`
    );
  }

  // Merge into SeasonTeamStats — primary index is endpoint 148 (FG%)
  const stats: Record<string, SeasonTeamStats> = {};

  for (const seoname of byId[148].keys()) {
    const scr = byId[145].get(seoname);
    const fg  = byId[148].get(seoname);
    const ft  = byId[150].get(seoname);
    const reb = byId[151].get(seoname);
    const thr = byId[152].get(seoname);
    const blk = byId[214].get(seoname);
    const stl = byId[215].get(seoname);
    const ast = byId[216].get(seoname);
    const tov = byId[217].get(seoname);

    // Fail closed: the 8 core stat endpoints (148/150/151/152/214/215/216/217) are required.
    // Endpoint 145 (PPG) is non-blocking — if missing or zero, pointsPerGame defaults to 0.
    if (!fg || !ft || !reb || !thr || !blk || !stl || !ast || !tov) {
      console.warn(`[seasonStatsAdapter] ${seoname}: missing data from ≥1 core endpoint — excluded`);
      continue;
    }

    // Endpoint 145 (Scoring Offense): field name inferred as "PPG" from API naming patterns.
    // Non-blocking: if scr is missing or PPG=0, log and default to 0.
    // The PPG=0 warn also fires when the field name is wrong — check Available keys.
    let rawPpg = 0;
    if (scr) {
      rawPpg = parseNum(scr["PPG"]);
      if (rawPpg === 0) {
        console.warn(
          `[seasonStatsAdapter] ${seoname}: endpoint 145 PPG=0 — ` +
          `field name may be incorrect. Available keys: ${Object.keys(scr).join(", ")}`
        );
      }
    }

    stats[seoname] = {
      gamesPlayed:           parseNum(fg["GM"]),
      fieldGoalsMade:        parseNum(fg["FGM"]),
      fieldGoalsAttempted:   parseNum(fg["FGA"]),
      fieldGoalPct:          parseNum(fg["FG%"]) / 100,

      freeThrowsMade:        parseNum(ft["FT"]),
      freeThrowsAttempted:   parseNum(ft["FTA"]),
      freeThrowPct:          parseNum(ft["FT%"]) / 100,

      reboundsPerGame:       parseNum(reb["RPG"]),
      oppReboundsPerGame:    parseNum(reb["OPP RPG"]),
      reboundMargin:         parseNum(reb["REB MAR"]),

      threesMade:            parseNum(thr["3FG"]),
      threesAttempted:       parseNum(thr["3FGA"]),
      threePointPct:         parseNum(thr["3FG%"]) / 100,

      blocksPerGame:         parseNum(blk["BKPG"]),
      stealsPerGame:         parseNum(stl["STPG"]),
      assistsPerGame:        parseNum(ast["APG"]),

      turnoversTotal:        parseNum(tov["TO"]),
      turnoversPerGame:      parseNum(tov["TOPG"]),

      pointsPerGame:         rawPpg,
    };
  }

  cache.set(year, { stats, fetchedAt: Date.now() });
  const keys = Object.keys(stats);
  console.log(
    `[seasonStatsAdapter] cached season stats for ${keys.length} teams (year=${year}). ` +
    `Sample keys: ${keys.slice(0, 10).join(", ")}`
  );
  return stats;
}
