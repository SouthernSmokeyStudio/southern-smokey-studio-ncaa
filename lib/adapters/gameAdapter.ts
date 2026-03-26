// gameAdapter.ts
// Endpoint: GET /game/{gameId}
// Returns single game identity, teams, scores, status, and location.
// Does NOT return player or team stats — those come from boxscoreAdapter.
// Field names confirmed via live API inspection (Step 1, game 6595954).
// Fail closed: return null on bad response or missing required fields.

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

function mapTeam(raw: Record<string, unknown>): CanonicalTeam | null {
  const teamId = raw.teamId;
  const nameShort = raw.nameShort;
  if (typeof teamId !== "string" || typeof nameShort !== "string") {
    console.warn("[gameAdapter] team missing teamId or nameShort", raw);
    return null;
  }

  const rawScore = raw.score;
  const score =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string" && rawScore !== ""
      ? parseFloat(rawScore)
      : null;

  const rawSeed = raw.seed;
  const seed =
    rawSeed !== null && rawSeed !== undefined ? String(rawSeed) : null;

  return {
    id: teamId,
    name: nameShort,
    seed,
    score: score !== null && !isNaN(score as number) ? (score as number) : null,
    winner: raw.isWinner === true,
  };
}

// ---------------------------------------------------------------------------
// Exported game detail type — superset of CanonicalGame for game-level data
// ---------------------------------------------------------------------------

export interface GameDetail extends CanonicalGame {
  venue: string | null;
  city: string | null;
  state: string | null;
  network: string | null;
  startTimeEpoch: number | null;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchGame(gameId: string): Promise<GameDetail | null> {
  const url = `${BASE_URL}/game/${gameId}`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      console.warn(`[gameAdapter] HTTP ${res.status} for game ${gameId}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn(`[gameAdapter] fetch failed for game ${gameId}`, err);
    return null;
  }

  const contests = data.contests;
  if (!Array.isArray(contests) || contests.length === 0) {
    console.warn(`[gameAdapter] no contests array for game ${gameId}`);
    return null;
  }

  // Find the contest matching the requested gameId
  const contest =
    contests.find(
      (c: Record<string, unknown>) => String(c.id) === String(gameId)
    ) ?? contests[0];

  if (!contest || typeof contest !== "object") {
    console.warn(`[gameAdapter] contest not found for game ${gameId}`);
    return null;
  }

  const rawTeams = contest.teams;
  if (!Array.isArray(rawTeams) || rawTeams.length === 0) {
    console.warn(`[gameAdapter] no teams for game ${gameId}`);
    return null;
  }

  const teams: CanonicalTeam[] = [];
  for (const rt of rawTeams) {
    const mapped = mapTeam(rt as Record<string, unknown>);
    if (!mapped) {
      console.warn("[gameAdapter] failed to map team", rt);
      return null; // fail closed — partial team data is unusable
    }
    teams.push(mapped);
  }

  const location =
    contest.location && typeof contest.location === "object"
      ? (contest.location as Record<string, unknown>)
      : null;

  const title = contest.title ?? contest.finalMessage;
  const description =
    typeof title === "string" && title
      ? title
      : teams.map((t) => t.name).join(" vs ");

  return {
    game_id: String(gameId),
    status: mapGameState(contest.gameState as string),
    description,
    teams,
    team_stats_raw: {},    // populated by boxscoreAdapter
    player_stats_raw: {},  // populated by boxscoreAdapter
    stale: false,
    last_synced: new Date().toISOString(),
    venue: location ? String(location.venue ?? "") || null : null,
    city: location ? String(location.city ?? "") || null : null,
    state: location ? String(location.stateUsps ?? "") || null : null,
    network:
      contest.network && typeof contest.network === "string"
        ? contest.network
        : null,
    startTimeEpoch:
      contest.startTimeEpoch && typeof contest.startTimeEpoch === "number"
        ? contest.startTimeEpoch
        : null,
  };
}
