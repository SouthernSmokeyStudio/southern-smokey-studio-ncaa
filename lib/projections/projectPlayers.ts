// lib/projections/projectPlayers.ts
// v0.1 — Player projection engine.
//
// Inputs:
//   - SlateGame (the scheduled game being projected)
//   - GameProjection (must be 'projected', not 'blocked')
//   - allGames: SlateGame[] (full slate — used to find player baselines from
//     prior completed tournament games for the same team)
//
// Method:
//   1. Find the most recent completed tournament game for the team that has
//      player_stats_raw populated (prior round boxscore).
//   2. Use each player's stat line from that game as the baseline.
//   3. Apply a minutes scaler: projected winners in blowouts get garbage-time
//      reduction; projected losers play full minutes.
//   4. Scale all counting stats proportionally to projected minutes.
//   5. Compute DraftKings fantasy points from projected stats.
//
// Fail-closed:
//   - No completed baseline game found → team blocked
//   - GameProjection is blocked → team blocked
//   - Player played < 5 minutes in baseline → excluded (DNP / garbage time)
//
// NOT backtested. Single-game sample baseline is high-variance.
// DK double-double and triple-double bonuses are approximated from projected stats.

import type { SlateGame, RawPlayerStats } from "@/lib/types";
import type {
  GameProjection,
  PlayerProjection,
  TeamPlayerProjections,
} from "@/lib/projections/types";

const PLAYER_MODEL_VERSION = "v0.1-boxscore";
const MIN_MINUTES_THRESHOLD = 5; // exclude players with fewer than this many minutes

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
// Find the most recent completed tournament game with player stats for a team
// ---------------------------------------------------------------------------

function findPlayerBaseline(
  teamSeoname: string,
  allGames: SlateGame[]
): RawPlayerStats[] | null {
  const completed = allGames.filter(
    (g) =>
      g.status === "final" &&
      Array.isArray(g.player_stats_raw[teamSeoname]) &&
      g.player_stats_raw[teamSeoname].length > 0
  );

  if (completed.length === 0) return null;

  // Most recent = highest startTimeEpoch; fallback to last in array
  const sorted = [...completed].sort(
    (a, b) => (b.startTimeEpoch ?? 0) - (a.startTimeEpoch ?? 0)
  );

  return sorted[0].player_stats_raw[teamSeoname];
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

  // Gate 2: find a completed game with player stats for this team
  const baseline = findPlayerBaseline(teamRef.id, allGames);
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

  const players: PlayerProjection[] = baseline
    .filter((p) => p.minutesPlayed >= MIN_MINUTES_THRESHOLD)
    .map((p): PlayerProjection => {
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
      "all players in baseline game filtered out — none had ≥5 minutes played"
    );
  }

  return {
    game_id:          game.game_id,
    team_id:          teamRef.id,
    team_name:        teamRef.name,
    game_projection:  gameProjection,
    players,
    projection_status: "projected",
    blocked_reason:   null,
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
