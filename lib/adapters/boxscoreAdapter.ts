// boxscoreAdapter.ts
// SINGLE SOURCE for both player_stats_raw and team_stats_raw.
// Endpoint: GET /game/{gameId}/boxscore
// Field names confirmed via live API inspection (Step 1, game 6595954).
// All stat values arrive as strings from the API — parsed to numbers here.
// Fail closed: return null on bad response, missing structure, or fetch error.

import type { RawPlayerStats, RawTeamStats } from "@/lib/types";

const BASE_URL = "https://ncaa-api.henrygd.me";

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseNum(val: unknown): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parsePct(val: unknown): number {
  if (typeof val === "string") {
    const stripped = val.replace("%", "").trim();
    const n = parseFloat(stripped);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Player row mapper
// ---------------------------------------------------------------------------

function mapPlayer(raw: Record<string, unknown>): RawPlayerStats | null {
  if (!raw || typeof raw !== "object") return null;

  const firstName = raw.firstName;
  const lastName = raw.lastName;
  if (typeof firstName !== "string" || typeof lastName !== "string") {
    console.warn("[boxscoreAdapter] player missing firstName/lastName", raw);
    return null;
  }

  return {
    id: parseNum(raw.id),
    number: parseNum(raw.number),
    firstName,
    lastName,
    position: typeof raw.position === "string" ? raw.position : "",
    minutesPlayed: parseNum(raw.minutesPlayed),
    year: typeof raw.year === "string" ? raw.year : "",
    elig: typeof raw.elig === "string" ? raw.elig : "",
    starter: raw.starter === true,
    fieldGoalsMade: parseNum(raw.fieldGoalsMade),
    fieldGoalsAttempted: parseNum(raw.fieldGoalsAttempted),
    freeThrowsMade: parseNum(raw.freeThrowsMade),
    freeThrowsAttempted: parseNum(raw.freeThrowsAttempted),
    threePointsMade: parseNum(raw.threePointsMade),
    threePointsAttempted: parseNum(raw.threePointsAttempted),
    offensiveRebounds: parseNum(raw.offensiveRebounds),
    totalRebounds: parseNum(raw.totalRebounds),
    assists: parseNum(raw.assists),
    turnovers: parseNum(raw.turnovers),
    personalFouls: parseNum(raw.personalFouls),
    steals: parseNum(raw.steals),
    blockedShots: parseNum(raw.blockedShots),
    points: parseNum(raw.points),
  };
}

// ---------------------------------------------------------------------------
// Team stats mapper
// ---------------------------------------------------------------------------

function mapTeamStats(raw: Record<string, unknown>): RawTeamStats | null {
  if (!raw || typeof raw !== "object") return null;

  return {
    fieldGoalsMade: parseNum(raw.fieldGoalsMade),
    fieldGoalsAttempted: parseNum(raw.fieldGoalsAttempted),
    fieldGoalPercentage: parsePct(raw.fieldGoalPercentage),
    freeThrowsMade: parseNum(raw.freeThrowsMade),
    freeThrowsAttempted: parseNum(raw.freeThrowsAttempted),
    freeThrowPercentage: parsePct(raw.freeThrowPercentage),
    threePointsMade: parseNum(raw.threePointsMade),
    threePointsAttempted: parseNum(raw.threePointsAttempted),
    threePointPercentage: parsePct(raw.threePointPercentage),
    offensiveRebounds: parseNum(raw.offensiveRebounds),
    totalRebounds: parseNum(raw.totalRebounds),
    assists: parseNum(raw.assists),
    turnovers: parseNum(raw.turnovers),
    personalFouls: parseNum(raw.personalFouls),
    steals: parseNum(raw.steals),
    blockedShots: parseNum(raw.blockedShots),
    points: parseNum(raw.points),
  };
}

// ---------------------------------------------------------------------------
// BoxscoreResult — what this adapter returns
// ---------------------------------------------------------------------------

export interface BoxscoreResult {
  // Both dicts are keyed by seoname (e.g. "dayton"), extracted from the
  // top-level teams[] array that the /boxscore endpoint returns alongside
  // teamBoxscore[]. This matches CanonicalTeam.id from bracketAdapter and
  // scoreboardAdapter, enabling a direct key-join in the drawer.
  // Falls back to numeric teamId string only when seoname is absent.
  player_stats_raw: Record<string, RawPlayerStats[]>;
  team_stats_raw: Record<string, RawTeamStats>;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchBoxscore(
  gameId: string
): Promise<BoxscoreResult | null> {
  const url = `${BASE_URL}/game/${gameId}/boxscore`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      console.warn(
        `[boxscoreAdapter] HTTP ${res.status} for game ${gameId}`
      );
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn(`[boxscoreAdapter] fetch failed for game ${gameId}`, err);
    return null;
  }

  const teamBoxscore = data.teamBoxscore;
  if (!Array.isArray(teamBoxscore) || teamBoxscore.length === 0) {
    console.warn(
      `[boxscoreAdapter] missing teamBoxscore for game ${gameId}`
    );
    return null;
  }

  // Build numericTeamId → seoname from the top-level teams[] array.
  // Confirmed present in live API response (Step 1, game 6595954):
  //   teams[].teamId = "2118", teams[].seoname = "dayton"
  // This is the join key used by bracketAdapter and scoreboardAdapter.
  const numericToSeoname = new Map<string, string>();
  if (Array.isArray(data.teams)) {
    for (const t of data.teams as Record<string, unknown>[]) {
      const numericId = String(t.teamId ?? "");
      const seoname = typeof t.seoname === "string" ? t.seoname : "";
      if (numericId && seoname) {
        numericToSeoname.set(numericId, seoname);
      }
    }
  }

  if (numericToSeoname.size === 0) {
    console.warn(
      `[boxscoreAdapter] could not build seoname map for game ${gameId} — stats will be keyed by numeric teamId`
    );
  }

  const player_stats_raw: Record<string, RawPlayerStats[]> = {};
  const team_stats_raw: Record<string, RawTeamStats> = {};

  for (const entry of teamBoxscore) {
    const numericId = String(entry.teamId ?? "");
    if (!numericId) {
      console.warn("[boxscoreAdapter] teamBoxscore entry missing teamId", entry);
      continue;
    }
    // Use seoname as the canonical key; fall back to numericId only when absent.
    const teamId = numericToSeoname.get(numericId) ?? numericId;

    // Team stats
    if (entry.teamStats && typeof entry.teamStats === "object") {
      const ts = mapTeamStats(entry.teamStats as Record<string, unknown>);
      if (ts) {
        team_stats_raw[teamId] = ts;
      } else {
        console.warn(
          `[boxscoreAdapter] failed to map teamStats for teamId ${teamId}`
        );
      }
    }

    // Player stats
    if (Array.isArray(entry.playerStats)) {
      const players: RawPlayerStats[] = [];
      for (const p of entry.playerStats) {
        const mapped = mapPlayer(p as Record<string, unknown>);
        if (mapped) {
          players.push(mapped);
        } else {
          console.warn(
            `[boxscoreAdapter] skipped unmappable player row for teamId ${teamId}`,
            p
          );
        }
      }
      player_stats_raw[teamId] = players;
    }
  }

  if (
    Object.keys(team_stats_raw).length === 0 &&
    Object.keys(player_stats_raw).length === 0
  ) {
    console.warn(
      `[boxscoreAdapter] no valid data extracted for game ${gameId}`
    );
    return null;
  }

  return { player_stats_raw, team_stats_raw };
}
