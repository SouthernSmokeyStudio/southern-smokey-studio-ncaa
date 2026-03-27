// lib/projections/projectPlayers.ts
// v0.2 — Player projection engine.
//
// v0.2 changes from v0.1:
//   - Baseline is now the AVERAGE across all completed tournament games for each
//     player, not just the most recent game. This reduces single-game variance.
//     A player who scored 30 in Round 1 but averages 15 will be projected at ~15,
//     not 30, once Round 2 data is available.
//   - Players are averaged by player_id across all games where they appeared.
//   - Games where a player didn't appear (minutesPlayed < MIN_MINUTES_THRESHOLD)
//     are still excluded per-game before averaging.
//
// Inputs:
//   - SlateGame (the scheduled game being projected)
//   - GameProjection (must be 'projected', not 'blocked')
//   - allGames: SlateGame[] (full slate — used to find player baselines from
//     all completed tournament games for the same team)
//
// Method:
//   1. Find all completed tournament games for the team that have player_stats_raw.
//   2. Average each player's stat line across all their appearances.
//   3. Apply a minutes scaler: projected winners in blowouts get garbage-time
//      reduction; projected losers play full minutes.
//   4. Scale all counting stats proportionally to projected minutes.
//   5. Compute DraftKings fantasy points from projected stats.
//
// Fail-closed:
//   - No completed baseline game found → team blocked
//   - GameProjection is blocked → team blocked
//   - Player averaged < 5 minutes across appearances → excluded

import type { SlateGame, RawPlayerStats } from "@/lib/types";
import type {
  GameProjection,
  PlayerProjection,
  TeamPlayerProjections,
} from "@/lib/projections/types";

const PLAYER_MODEL_VERSION = "v0.2-boxscore";
const MIN_MINUTES_THRESHOLD = 5; // exclude players averaging fewer minutes than this

// ---------------------------------------------------------------------------
// DraftKings scoring
// ---------------------------------------------------------------------------

function computeDkPoints(
  points: number,
  threesMade: number,
  rebounds: number,
  assists: number,
  steals: number,
  blocks: number,
  turnovers: number
): number {
  let dk = 0;
  dk += points * 1.0;
  dk += threesMade * 0.5;   // 3PM bonus (on top of 1pt per point already counted)
  dk += rebounds * 1.25;
  dk += assists * 1.5;
  dk += steals * 2.0;
  dk += blocks * 2.0;
  dk += turnovers * -0.5;

  // Double-double: +1.5 when ≥2 of the following categories reach 10
  // Triple-double: +3 additional when ≥3 categories reach 10
  const ddCats = [points, rebounds, assists, steals, blocks].filter(
    (v) => v >= 10
  ).length;
  if (ddCats >= 2) dk += 1.5;
  if (ddCats >= 3) dk += 3.0;

  return Math.round(dk * 100) / 100;
}

// ---------------------------------------------------------------------------
// Minutes scaler — garbage time adjustment
// Applied only to projected winners; projected losers maintain full minutes
// as they play through in an attempt to close the gap.
// ---------------------------------------------------------------------------

function getMinutesScaler(
  isProjectedWinner: boolean,
  projectedMargin: number | null
): number {
  if (!isProjectedWinner || projectedMargin === null) return 1.0;
  const abs = Math.abs(projectedMargin);
  if (abs >= 20) return 0.85; // heavy garbage time
  if (abs >= 10) return 0.93; // moderate garbage time
  return 1.0;                 // close game — full minutes
}

// ---------------------------------------------------------------------------
// Aggregate player baselines across all completed tournament games
// Returns averaged RawPlayerStats[] or null if no completed game exists
// ---------------------------------------------------------------------------

function aggregatePlayerBaselines(
  teamSeoname: string,
  allGames: SlateGame[]
): RawPlayerStats[] | null {
  const completedGames = allGames.filter(
    (g) =>
      g.status === "final" &&
      Array.isArray(g.player_stats_raw[teamSeoname]) &&
      g.player_stats_raw[teamSeoname].length > 0
  );

  if (completedGames.length === 0) return null;

  // Group appearances by player_id across all completed games
  const playerMap = new Map<number, RawPlayerStats[]>();

  for (const game of completedGames) {
    for (const stats of game.player_stats_raw[teamSeoname]) {
      // Exclude DNPs and garbage-only appearances before averaging
      if (stats.minutesPlayed < MIN_MINUTES_THRESHOLD) continue;
      const existing = playerMap.get(stats.id) ?? [];
      existing.push(stats);
      playerMap.set(stats.id, existing);
    }
  }

  if (playerMap.size === 0) return null;

  // Average each player's stats across their appearances
  const averaged: RawPlayerStats[] = [];

  for (const [, appearances] of playerMap) {
    const n = appearances.length;
    const base = appearances[0]; // use first appearance for non-numeric identity fields

    const avgNum = (selector: (s: RawPlayerStats) => number): number =>
      appearances.reduce((acc, s) => acc + selector(s), 0) / n;

    averaged.push({
      // Identity fields — use most recent appearance (last in array = most recent or first seen)
      id:                    base.id,
      number:                base.number,
      firstName:             base.firstName,
      lastName:              base.lastName,
      position:              base.position,
      year:                  base.year,
      elig:                  base.elig,
      starter:               base.starter,

      // Averaged counting stats
      minutesPlayed:         avgNum((s) => s.minutesPlayed),
      fieldGoalsMade:        avgNum((s) => s.fieldGoalsMade),
      fieldGoalsAttempted:   avgNum((s) => s.fieldGoalsAttempted),
      freeThrowsMade:        avgNum((s) => s.freeThrowsMade),
      freeThrowsAttempted:   avgNum((s) => s.freeThrowsAttempted),
      threePointsMade:       avgNum((s) => s.threePointsMade),
      threePointsAttempted:  avgNum((s) => s.threePointsAttempted),
      offensiveRebounds:     avgNum((s) => s.offensiveRebounds),
      totalRebounds:         avgNum((s) => s.totalRebounds),
      assists:               avgNum((s) => s.assists),
      turnovers:             avgNum((s) => s.turnovers),
      personalFouls:         avgNum((s) => s.personalFouls),
      steals:                avgNum((s) => s.steals),
      blockedShots:          avgNum((s) => s.blockedShots),
      points:                avgNum((s) => s.points),
    });
  }

  return averaged.length > 0 ? averaged : null;
}

// ---------------------------------------------------------------------------
// Project one team's players
// ---------------------------------------------------------------------------

function projectTeamPlayers(
  game: SlateGame,
  teamIndex: 0 | 1,
  gameProjection: GameProjection,
  allGames: SlateGame[]
): TeamPlayerProjections {
  const teamRef = game.teams[teamIndex];

  if (!teamRef) {
    return {
      game_id: game.game_id,
      team_id: "unknown",
      team_name: "Unknown",
      game_projection: gameProjection,
      players: [],
      projection_status: "blocked",
      blocked_reason: `team at index ${teamIndex} not found in game ${game.game_id}`,
    };
  }

  const blocked = (reason: string): TeamPlayerProjections => ({
    game_id: game.game_id,
    team_id: teamRef.id,
    team_name: teamRef.name,
    game_projection: gameProjection,
    players: [],
    projection_status: "blocked",
    blocked_reason: reason,
  });

  // Gate 1: game projection must be valid
  if (gameProjection.projection_status === "blocked") {
    return blocked(
      `game projection is blocked: ${gameProjection.blocked_reason ?? "unknown reason"}`
    );
  }

  // Gate 2: find averaged baseline across all completed games for this team
  const baseline = aggregatePlayerBaselines(teamRef.id, allGames);
  if (!baseline) {
    return blocked(
      `no completed tournament game with player stats found for "${teamRef.id}" — ` +
        `cannot establish player baseline (team may be in their first game of the tournament)`
    );
  }

  // Determine if this team is the projected winner (margin is team_a perspective)
  const isWinner =
    teamIndex === 0
      ? gameProjection.projected_winner === "a"
      : gameProjection.projected_winner === "b";

  const minScaler = getMinutesScaler(isWinner, gameProjection.projected_margin);

  const generatedAt = new Date().toISOString();

  const players: PlayerProjection[] = baseline.map((p): PlayerProjection => {
    const projMinutes = Math.round(p.minutesPlayed * minScaler * 10) / 10;
    const statScaler  = projMinutes / (p.minutesPlayed || 1);

    const projPoints    = Math.round(p.points          * statScaler * 10) / 10;
    const projRebounds  = Math.round(p.totalRebounds   * statScaler * 10) / 10;
    const projAssists   = Math.round(p.assists         * statScaler * 10) / 10;
    const projTurnovers = Math.round(p.turnovers       * statScaler * 10) / 10;
    const projSteals    = Math.round(p.steals          * statScaler * 10) / 10;
    const projBlocks    = Math.round(p.blockedShots    * statScaler * 10) / 10;
    const proj3PM       = Math.round(p.threePointsMade * statScaler * 10) / 10;

    const projDk = computeDkPoints(
      projPoints,
      proj3PM,
      projRebounds,
      projAssists,
      projSteals,
      projBlocks,
      projTurnovers
    );

    return {
      player_id:           String(p.id),
      player_name:         `${p.firstName} ${p.lastName}`,
      position:            p.position,
      team_id:             teamRef.id,
      game_id:             game.game_id,
      projection_status:   "projected",
      projected_minutes:   projMinutes,
      projected_points:    projPoints,
      projected_rebounds:  projRebounds,
      projected_assists:   projAssists,
      projected_turnovers: projTurnovers,
      projected_steals:    projSteals,
      projected_blocks:    projBlocks,
      projected_dk_points: projDk,
      blocked_reason:      null,
      model_version:       PLAYER_MODEL_VERSION,
      generated_at:        generatedAt,
    };
  });

  // Sort descending by projected DK points
  players.sort(
    (a, b) => (b.projected_dk_points ?? 0) - (a.projected_dk_points ?? 0)
  );

  if (players.length === 0) {
    return blocked(
      "all players in baseline filtered out — none met the minimum minutes threshold"
    );
  }

  return {
    game_id:           game.game_id,
    team_id:           teamRef.id,
    team_name:         teamRef.name,
    game_projection:   gameProjection,
    players,
    projection_status: "projected",
    blocked_reason:    null,
  };
}

// ---------------------------------------------------------------------------
// Main export — project all players for both teams in one scheduled game
// ---------------------------------------------------------------------------

export function projectGamePlayers(
  game: SlateGame,
  gameProjection: GameProjection,
  allGames: SlateGame[]
): { teamA: TeamPlayerProjections; teamB: TeamPlayerProjections } {
  return {
    teamA: projectTeamPlayers(game, 0, gameProjection, allGames),
    teamB: projectTeamPlayers(game, 1, gameProjection, allGames),
  };
}
