// lib/projections/prepareGameInputs.ts
// Phase 1 — Projection input layer.
//
// Validates a CanonicalGame and extracts the typed inputs required by the
// projection engine. Returns null with a blocked_reason when required data
// is absent or structurally invalid.
//
// Rules (MANIFESTO.md §2, §5):
//   - Fail closed: any missing required field → null
//   - No imputation: do not substitute zero or average for missing values
//   - Tournament-agnostic: no bracket-specific logic
//   - team_stats_raw must exist for BOTH teams

import type { CanonicalGame, RawTeamStats } from "@/lib/types";
import type { PreparedGameInputs } from "@/lib/projections/types";

// ---------------------------------------------------------------------------
// Required numeric fields — all must be present and finite (not NaN/Inf).
// Zero is a valid observed value; we only reject genuinely missing data.
// ---------------------------------------------------------------------------

const REQUIRED_STAT_FIELDS: (keyof RawTeamStats)[] = [
  "fieldGoalsMade",
  "fieldGoalsAttempted",
  "threePointsMade",
  "threePointsAttempted",
  "freeThrowsMade",
  "freeThrowsAttempted",
  "offensiveRebounds",
  "totalRebounds",
  "assists",
  "turnovers",
  "steals",
  "blockedShots",
  "points",
  "fieldGoalPercentage",
  "threePointPercentage",
  "freeThrowPercentage",
];

// ---------------------------------------------------------------------------
// Guard: verify all required fields are present and finite numbers
// ---------------------------------------------------------------------------

function validateStats(
  stats: RawTeamStats,
  teamName: string
): string | null {
  for (const field of REQUIRED_STAT_FIELDS) {
    const val = stats[field];
    if (typeof val !== "number" || !isFinite(val)) {
      return `team "${teamName}" missing or non-finite field: ${field}`;
    }
  }

  // fieldGoalsAttempted must be > 0 to compute shooting percentages.
  // A team with 0 FGA is structurally malformed data for our engine.
  if (stats.fieldGoalsAttempted <= 0) {
    return `team "${teamName}" has fieldGoalsAttempted = ${stats.fieldGoalsAttempted} — cannot compute shooting rates`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface PrepareResult {
  inputs: PreparedGameInputs | null;
  blocked_reason: string | null;
}

export function prepareGameInputs(game: CanonicalGame): PrepareResult {
  const blocked = (reason: string): PrepareResult => ({
    inputs: null,
    blocked_reason: reason,
  });

  // Gate 1: game must have exactly two teams
  if (!game.teams || game.teams.length < 2) {
    return blocked(
      `game ${game.game_id} has ${game.teams?.length ?? 0} team(s) — need 2`
    );
  }

  const [teamRefA, teamRefB] = game.teams;

  // Gate 2: team_stats_raw must be populated for both teams
  const statKeys = Object.keys(game.team_stats_raw);
  if (statKeys.length === 0) {
    return blocked(
      "team_stats_raw is empty — game has not been completed or boxscore fetch failed"
    );
  }
  if (statKeys.length === 1) {
    return blocked(
      `team_stats_raw contains only one team (${statKeys[0]}) — incomplete boxscore`
    );
  }

  // Gate 3: look up stats for each team by seoname (canonical key after fix)
  const statsA = game.team_stats_raw[teamRefA.id];
  const statsB = game.team_stats_raw[teamRefB.id];

  if (!statsA) {
    return blocked(
      `no team_stats_raw entry for team_a "${teamRefA.id}" — available keys: ${statKeys.join(", ")}`
    );
  }
  if (!statsB) {
    return blocked(
      `no team_stats_raw entry for team_b "${teamRefB.id}" — available keys: ${statKeys.join(", ")}`
    );
  }

  // Gate 4: validate required fields on each team's stats object
  const errA = validateStats(statsA, teamRefA.name);
  if (errA) return blocked(errA);

  const errB = validateStats(statsB, teamRefB.name);
  if (errB) return blocked(errB);

  // All gates passed — return validated inputs
  return {
    inputs: {
      game_id: game.game_id,
      team_a: {
        id: teamRefA.id,
        name: teamRefA.name,
        canonicalTeam: teamRefA,
        stats: statsA,
      },
      team_b: {
        id: teamRefB.id,
        name: teamRefB.name,
        canonicalTeam: teamRefB,
        stats: statsB,
      },
    },
    blocked_reason: null,
  };
}
