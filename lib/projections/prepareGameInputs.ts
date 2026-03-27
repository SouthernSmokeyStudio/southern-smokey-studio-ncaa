// lib/projections/prepareGameInputs.ts
// v0.2 — Projection input layer.
//
// Validates a SlateGame and extracts the typed inputs required by the
// projection engine. Returns null with a blocked_reason when required
// season stats are absent or structurally invalid.
//
// v0.2 change: reads season_stats_a / season_stats_b from SlateGame
//   instead of team_stats_raw (single-game boxscore).
//
// Rules (MANIFESTO.md §2, §5):
//   - Fail closed: any missing required field → null
//   - No imputation: do not substitute zero or average for missing values
//   - Tournament-agnostic: no bracket-specific logic
//   - season_stats_a and season_stats_b must both be non-null

import type { SlateGame } from "@/lib/types";
import type { PreparedGameInputs, TeamInput } from "@/lib/projections/types";

// ---------------------------------------------------------------------------
// Guard: verify season stats are usable for feature engineering
// ---------------------------------------------------------------------------

function validateSeasonStats(
  stats: NonNullable<SlateGame["season_stats_a"]>,
  teamName: string
): string | null {
  // fieldGoalsAttempted must be > 0 — it's the denominator in eFG% and FTR.
  if (stats.fieldGoalsAttempted <= 0) {
    return `team "${teamName}" has fieldGoalsAttempted = ${stats.fieldGoalsAttempted} — cannot compute shooting rates`;
  }
  // gamesPlayed must be > 0 — indicates real season data was present
  if (stats.gamesPlayed <= 0) {
    return `team "${teamName}" has gamesPlayed = ${stats.gamesPlayed} — season stats appear empty`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PrepareResult {
  inputs: PreparedGameInputs | null;
  blocked_reason: string | null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function prepareGameInputs(game: SlateGame): PrepareResult {
  const blocked = (reason: string): PrepareResult => ({
    inputs: null,
    blocked_reason: reason,
  });

  // Gate 1: game must have at least two teams
  if (!game.teams || game.teams.length < 2) {
    return blocked(
      `game ${game.game_id} has ${game.teams?.length ?? 0} team(s) — need 2`
    );
  }

  const [teamRefA, teamRefB] = game.teams;

  // Gate 2: season_stats_a must be present
  if (!game.season_stats_a) {
    return blocked(
      `no season stats for team_a "${teamRefA.id}" (${teamRefA.name}) — team not found in season stats cache`
    );
  }

  // Gate 3: season_stats_b must be present
  if (!game.season_stats_b) {
    return blocked(
      `no season stats for team_b "${teamRefB.id}" (${teamRefB.name}) — team not found in season stats cache`
    );
  }

  // Gate 4: validate each team's stats are structurally usable
  const errA = validateSeasonStats(game.season_stats_a, teamRefA.name);
  if (errA) return blocked(errA);

  const errB = validateSeasonStats(game.season_stats_b, teamRefB.name);
  if (errB) return blocked(errB);

  // All gates passed
  const teamA: TeamInput = {
    id: teamRefA.id,
    name: teamRefA.name,
    canonicalTeam: teamRefA,
    stats: game.season_stats_a,
  };

  const teamB: TeamInput = {
    id: teamRefB.id,
    name: teamRefB.name,
    canonicalTeam: teamRefB,
    stats: game.season_stats_b,
  };

  return {
    inputs: {
      game_id: game.game_id,
      team_a: teamA,
      team_b: teamB,
    },
    blocked_reason: null,
  };
}
