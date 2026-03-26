// bracketAdapter.ts
// Endpoint: GET /brackets/basketball-men/d1/{year}
// Maps tournament structure: game_id, round, region, seeds, teams.
// No player or team stats — bracket provides structure only.
// Field names confirmed via live API inspection (2026 bracket, 2026-03-26).
// Fail closed: return null on bad response, skip malformed game entries.
//
// NOTE: CanonicalGame does not have round/region fields in the current contract.
// Those fields are preserved in BracketGame (see below) and are available
// to consumers that need bracket-specific structure. The CanonicalGame emitted
// here carries team identity and status only.

import type { CanonicalGame, CanonicalTeam, LiveStatus } from "@/lib/types";

const BASE_URL = "https://ncaa-api.henrygd.me";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapGameState(state: string | undefined | null): LiveStatus {
  if (state === "F" || state === "final") return "final";
  if (state === "live" || state === "I") return "live";
  return "scheduled";
}

function mapBracketTeam(raw: Record<string, unknown>): CanonicalTeam | null {
  const nameShort = raw.nameShort;
  const seoname = raw.seoname;

  if (typeof nameShort !== "string" || !nameShort) {
    console.warn("[bracketAdapter] team missing nameShort", raw);
    return null;
  }

  const id =
    typeof seoname === "string" && seoname ? seoname : nameShort;

  const rawSeed = raw.seed;
  const seed =
    rawSeed !== null && rawSeed !== undefined ? String(rawSeed) : null;

  const rawScore = raw.score;
  const score =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string" && rawScore !== ""
      ? parseFloat(rawScore)
      : null;

  return {
    id,
    name: nameShort,
    seed,
    score: score !== null && !isNaN(score as number) ? (score as number) : null,
    winner: raw.isWinner === true,
  };
}

// ---------------------------------------------------------------------------
// BracketGame — CanonicalGame + bracket-specific structural fields
// ---------------------------------------------------------------------------

export interface BracketGame extends CanonicalGame {
  bracketPositionId: number | null;
  bracketId: number | null;
  sectionId: number | null;        // maps to region in bracket UI
  victorBracketPositionId: number | null;
  startDate: string | null;
  startTimeEpoch: number | null;
  broadcaster: string | null;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchBracket(year: number): Promise<BracketGame[] | null> {
  const url = `${BASE_URL}/brackets/basketball-men/d1/${year}`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      console.warn(`[bracketAdapter] HTTP ${res.status} for year ${year}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn(`[bracketAdapter] fetch failed for year ${year}`, err);
    return null;
  }

  const championships = data.championships;
  if (!Array.isArray(championships) || championships.length === 0) {
    console.warn(
      `[bracketAdapter] no championships array for year ${year}`
    );
    return null;
  }

  // Use the first (and typically only) championship entry
  const championship = championships[0] as Record<string, unknown>;
  const rawGames = championship?.games;

  if (!Array.isArray(rawGames) || rawGames.length === 0) {
    console.warn(`[bracketAdapter] no games in championship for year ${year}`);
    return null;
  }

  const bracketGames: BracketGame[] = [];

  for (const g of rawGames as Record<string, unknown>[]) {
    const contestId = g.contestId;
    if (contestId === null || contestId === undefined) {
      console.warn("[bracketAdapter] game missing contestId", g);
      continue;
    }

    const gameId = String(contestId);

    const rawTeams = g.teams;
    if (!Array.isArray(rawTeams) || rawTeams.length === 0) {
      console.warn(
        `[bracketAdapter] game ${gameId} has no teams — skipping`
      );
      continue;
    }

    const teams: CanonicalTeam[] = [];
    let teamMapFailed = false;
    for (const rt of rawTeams as Record<string, unknown>[]) {
      const mapped = mapBracketTeam(rt);
      if (!mapped) {
        console.warn(
          `[bracketAdapter] failed to map team in game ${gameId}`,
          rt
        );
        teamMapFailed = true;
        break;
      }
      teams.push(mapped);
    }

    if (teamMapFailed) continue;

    const broadcaster = g.broadcaster as Record<string, unknown> | undefined;

    const title = g.title;
    const description =
      typeof title === "string" && title
        ? title
        : teams.map((t) => t.name).join(" vs ");

    bracketGames.push({
      // CanonicalGame fields
      game_id: gameId,
      status: mapGameState(g.gameState as string),
      description,
      teams,
      team_stats_raw: {},    // bracket provides no stats
      player_stats_raw: {},  // bracket provides no stats
      stale: false,
      last_synced: new Date().toISOString(),

      // Bracket-specific structural fields
      bracketPositionId:
        typeof g.bracketPositionId === "number" ? g.bracketPositionId : null,
      bracketId:
        typeof g.bracketId === "number" ? g.bracketId : null,
      sectionId:
        typeof g.sectionId === "number" ? g.sectionId : null,
      victorBracketPositionId:
        typeof g.victorBracketPositionId === "number"
          ? g.victorBracketPositionId
          : null,
      startDate:
        typeof g.startDate === "string" && g.startDate ? g.startDate : null,
      startTimeEpoch:
        typeof g.startTimeEpoch === "number" ? g.startTimeEpoch : null,
      broadcaster:
        broadcaster && typeof broadcaster.name === "string"
          ? broadcaster.name
          : null,
    });
  }

  if (bracketGames.length === 0) {
    console.warn(
      `[bracketAdapter] no valid games extracted for year ${year}`
    );
    return null;
  }

  return bracketGames;
}
