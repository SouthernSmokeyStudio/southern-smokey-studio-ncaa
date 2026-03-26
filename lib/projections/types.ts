// lib/projections/types.ts
// Phase 4 — Projection contract types.
// Written first because all other projection modules import from here.
// Governed by MANIFESTO.md: no third-party ratings, no imputed values.

// ---------------------------------------------------------------------------
// PreparedGameInputs — output of prepareGameInputs.ts (Phase 1)
// Carries validated, typed references to both teams' raw stats.
// ---------------------------------------------------------------------------

import type { CanonicalTeam, RawTeamStats } from "@/lib/types";

export interface TeamInput {
  id: string;               // seoname — matches team_stats_raw key
  name: string;
  canonicalTeam: CanonicalTeam;
  stats: RawTeamStats;
}

export interface PreparedGameInputs {
  game_id: string;
  team_a: TeamInput;        // teams[0] from CanonicalGame
  team_b: TeamInput;        // teams[1] from CanonicalGame
}

// ---------------------------------------------------------------------------
// FeatureSet — output of engineerFeatures.ts (Phase 3)
// All values are team_a perspective: positive = team_a advantage.
// All features derived exclusively from confirmed boxscore fields.
// ---------------------------------------------------------------------------

export interface FeatureSet {
  // --- Four Factors (Dean Oliver framework, adapted) ---

  // Effective field goal percentage: (FGM + 0.5×3PM) / FGA
  // Weights 3-pointers at 1.5× a 2-pointer. Decimal [0, 1].
  // Raw fields: fieldGoalsMade, threePointsMade, fieldGoalsAttempted
  efg_pct_a: number;
  efg_pct_b: number;
  efg_pct_diff: number;     // efg_pct_a − efg_pct_b

  // Turnover rate: TOV / (FGA + 0.44×FTA + TOV)
  // Fraction of possessions ending in a turnover. Decimal [0, 1].
  // Raw fields: turnovers, fieldGoalsAttempted, freeThrowsAttempted
  tov_rate_a: number;
  tov_rate_b: number;
  tov_rate_diff: number;    // tov_rate_b − tov_rate_a (inverted: positive = A advantage)

  // Offensive rebounding rate: OREB / (OREB + opp_DREB)
  // Fraction of available offensive boards captured. Decimal [0, 1].
  // opp_DREB = opponent.totalRebounds − opponent.offensiveRebounds
  // Raw fields: offensiveRebounds, totalRebounds (both teams)
  oreb_rate_a: number;
  oreb_rate_b: number;
  oreb_rate_diff: number;   // oreb_rate_a − oreb_rate_b

  // Free throw rate: FTM / FGA
  // Measures ability to get to the line and convert. Decimal [0, +].
  // Raw fields: freeThrowsMade, fieldGoalsAttempted
  ftr_a: number;
  ftr_b: number;
  ftr_diff: number;         // ftr_a − ftr_b

  // --- Shooting breakdown ---

  // Three-point percentage differential (stored in RawTeamStats as 0–100 float)
  // Raw field: threePointPercentage
  three_pct_diff: number;   // (threePointPercentage_a − threePointPercentage_b) / 100 → decimal

  // Free throw percentage differential
  // Raw field: freeThrowPercentage
  ft_pct_diff: number;      // (freeThrowPercentage_a − freeThrowPercentage_b) / 100 → decimal

  // --- Possession outcomes ---

  // Assist differential: raw count difference
  // Raw field: assists
  ast_diff: number;         // assists_a − assists_b

  // Steal differential: raw count difference
  // Raw field: steals
  stl_diff: number;         // steals_a − steals_b

  // Block differential: raw count difference
  // Raw field: blockedShots
  blk_diff: number;         // blockedShots_a − blockedShots_b

  // Pace proxy: estimated possessions using Hollinger formula
  // FGA − OREB + TOV + 0.44×FTA
  // Single-game estimate only — not season-adjusted.
  pace_a: number;
  pace_b: number;
}

// ---------------------------------------------------------------------------
// GameProjection — output of the full projection pipeline
// ---------------------------------------------------------------------------

export interface GameProjection {
  game_id: string;

  // 'projected' when all required inputs were present and engine ran.
  // 'blocked' when required inputs are missing or engine could not run.
  projection_status: "projected" | "blocked";

  // Signed projected margin from team_a perspective.
  // Positive = team_a projected to win by that many points.
  // Null when projection_status is 'blocked'.
  projected_margin: number | null;

  // Which team is projected to win, by label. Null when blocked.
  projected_winner: "a" | "b" | null;

  // Confidence derived from projected margin magnitude.
  // low: |margin| < 5 | medium: 5–9 | high: ≥ 10
  // Null when blocked. Not statistically calibrated — v0.1 heuristic only.
  projection_confidence: "low" | "medium" | "high" | null;

  // Names of features that contributed to this projection.
  features_used: string[];

  // Numeric value of each feature at projection time.
  feature_values: Record<string, number>;

  // Semantic version of the projection model.
  // Increment when formula coefficients or feature set changes.
  model_version: string;

  // ISO 8601 timestamp of when this projection was computed.
  generated_at: string;

  // Human-readable explanation when projection_status is 'blocked'.
  // Null when projection_status is 'projected'.
  blocked_reason: string | null;
}
