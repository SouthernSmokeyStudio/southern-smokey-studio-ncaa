// scoreboardAdapter.ts
// Endpoint: GET /scoreboard/basketball-men/d1
// Maps live scores, game status, start times, seeds, networks.
// Field names confirmed via live API inspection (scoreboard, 2026-03-26).
// Fail closed: return null on bad response, skip malformed game entries.

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

function mapScoreboardTeam(
  raw: Record<string, unknown>,
  isHome: boolean
): CanonicalTeam | null {
  const names = raw.names;
  if (!names || typeof names !== "object") {
    console.warn("[scoreboardAdapter] team missing names object", raw);
    return null;
  }

  const n = names as Record<string, unknown>;
  const name =
    typeof n.short === "string" && n.short
      ? n.short
      : typeof n.char6 === "string"
      ? n.char6
      : null;

  if (!name) {
    console.warn("[scoreboardAdapter] team has no usable name", raw);
    return null;
  }

  const id = typeof n.seo === "string" && n.seo ? n.seo : name;

  const rawScore = raw.score;
  const score =
    typeof rawScore === "string" && rawScore !== ""
      ? parseFloat(rawScore)
      : typeof rawScore === "number"
      ? rawScore
      : null;

  const rawSeed = raw.seed;
  const seed =
    rawSeed !== null && rawSeed !== undefined && rawSeed !== ""
      ? String(rawSeed)
      : null;

  return {
    id,
    name,
    seed,
    score: score !== null && !isNaN(score) ? score : null,
    winner: raw.winner === true,
  };
}

// ---------------------------------------------------------------------------
// ScoreboardGame — per-game scoreboard shape (returned alongside CanonicalGame)
// ---------------------------------------------------------------------------

export interface ScoreboardEntry {
  game: CanonicalGame;
  network: string | null;
  startTime: string | null;
  startTimeEpoch: number | null;
  bracketId: number | null;
  bracketRound: number | null;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchScoreboard(): Promise<ScoreboardEntry[] | null> {
  const url = `${BASE_URL}/scoreboard/basketball-men/d1`;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(url, { next: { revalidate: 30 } });
    if (!res.ok) {
      console.warn(`[scoreboardAdapter] HTTP ${res.status}`);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn("[scoreboardAdapter] fetch failed", err);
    return null;
  }

  const rawGames = data.games;
  if (!Array.isArray(rawGames) || rawGames.length === 0) {
    console.warn("[scoreboardAdapter] no games array in scoreboard response");
    return null;
  }

  const entries: ScoreboardEntry[] = [];

  for (const wrapper of rawGames) {
    const g = wrapper?.game as Record<string, unknown> | undefined;
    if (!g) {
      console.warn("[scoreboardAdapter] malformed game wrapper", wrapper);
      continue;
    }

    const gameId = g.gameID;
    if (typeof gameId !== "string" || !gameId) {
      console.warn("[scoreboardAdapter] game missing gameID", g);
      continue;
    }

    const away = g.away as Record<string, unknown> | undefined;
    const home = g.home as Record<string, unknown> | undefined;

    if (!away || !home) {
      console.warn(
        `[scoreboardAdapter] game ${gameId} missing away or home`,
        g
      );
      continue;
    }

    const awayTeam = mapScoreboardTeam(away, false);
    const homeTeam = mapScoreboardTeam(home, true);

    if (!awayTeam || !homeTeam) {
      console.warn(
        `[scoreboardAdapter] skipping game ${gameId} — team mapping failed`
      );
      continue;
    }

    const title = g.title;
    const description =
      typeof title === "string" && title
        ? title
        : `${awayTeam.name} vs ${homeTeam.name}`;

    const canonicalGame: CanonicalGame = {
      game_id: gameId,
      status: mapGameState(g.gameState as string),
      description,
      teams: [awayTeam, homeTeam],
      team_stats_raw: {},    // populated by boxscoreAdapter when game is final
      player_stats_raw: {},  // populated by boxscoreAdapter when game is final
      stale: false,
      last_synced: new Date().toISOString(),
    };

    entries.push({
      game: canonicalGame,
      network:
        typeof g.network === "string" && g.network ? g.network : null,
      startTime:
        typeof g.startTime === "string" && g.startTime ? g.startTime : null,
      startTimeEpoch:
        typeof g.startTimeEpoch === "number" ? g.startTimeEpoch : null,
      bracketId:
        typeof g.bracketId === "number" ? g.bracketId : null,
      bracketRound:
        typeof g.bracketRound === "number" ? g.bracketRound : null,
    });
  }

  if (entries.length === 0) {
    console.warn("[scoreboardAdapter] no valid entries extracted from scoreboard");
    return null;
  }

  return entries;
}
