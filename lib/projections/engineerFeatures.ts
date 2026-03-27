// lib/projections/engineerFeatures.ts
// v0.2 — Feature engineering from season-level team averages.
//
// v0.2 changes from v0.1:
//   - Input: SeasonTeamStats (season averages) instead of RawTeamStats (single-game boxscore)
//   - oreb_rate replaced by reb_margin proxy (OREB not available in NCAA stats API)
//   - pace removed (Hollinger pace requires single-game play-by-play; not applicable to season avgs)
//   - All rate features use season totals for exact computation (not per-game averages)
//
// Feature framework: Dean Oliver Four Factors, extended with possession outcomes.
// No values are fabricated. safeDivide guards against division by zero.

import type { SeasonTeamStats } from "@/lib/types";
import type { FeatureSet } from "@/lib/projections/types";

// ---------------------------------------------------------------------------
// Safe division helper
// ---------------------------------------------------------------------------

function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0 || !isFinite(denominator)) return 0;
  const result = numerator / denominator;
  return isFinite(result) ? result : 0;
}

// ---------------------------------------------------------------------------
// Effective field goal percentage
// Formula:  (FGM + 0.5 × 3FG) / FGA  — using season totals
// Units:    decimal [0, 1]
// Why:      weights a made 3-pointer at 1.5× a 2-pointer.
// ---------------------------------------------------------------------------

function computeEfgPct(s: SeasonTeamStats): number {
  return safeDivide(
    s.fieldGoalsMade + 0.5 * s.threesMade,
    s.fieldGoalsAttempted
  );
}

// ---------------------------------------------------------------------------
// Turnover rate
// Formula:  TO / (FGA + 0.44 × FTA + TO)  — using season totals
// Units:    decimal [0, 1]
// Why:      0.44 converts FTA to possession estimates (and-ones, technical FTs).
// ---------------------------------------------------------------------------

function computeTovRate(s: SeasonTeamStats): number {
  const denom =
    s.fieldGoalsAttempted + 0.44 * s.freeThrowsAttempted + s.turnoversTotal;
  return safeDivide(s.turnoversTotal, denom);
}

// ---------------------------------------------------------------------------
// Free throw rate
// Formula:  FTM / FGA  — using season totals
// Units:    decimal [0, +∞)
// Why:      measures ability to get to the line AND convert.
// ---------------------------------------------------------------------------

function computeFtr(s: SeasonTeamStats): number {
  return safeDivide(s.freeThrowsMade, s.fieldGoalsAttempted);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function engineerFeatures(
  statsA: SeasonTeamStats,
  statsB: SeasonTeamStats
): FeatureSet {
  // Four Factors
  const efg_pct_a = computeEfgPct(statsA);
  const efg_pct_b = computeEfgPct(statsB);

  const tov_rate_a = computeTovRate(statsA);
  const tov_rate_b = computeTovRate(statsB);

  const ftr_a = computeFtr(statsA);
  const ftr_b = computeFtr(statsB);

  // Rebound margin proxy (replaces oreb_rate — OREB not in NCAA stats API)
  // reboundMargin = RPG − OPP RPG, already computed in the adapter from endpoint 151.
  const reb_margin_a = statsA.reboundMargin;
  const reb_margin_b = statsB.reboundMargin;

  // 3PT% and FT% are stored as decimals in SeasonTeamStats (adapter divides by 100)
  const three_pct_diff = statsA.threePointPct - statsB.threePointPct;
  const ft_pct_diff    = statsA.freeThrowPct  - statsB.freeThrowPct;

  return {
    // Four Factors
    efg_pct_a,
    efg_pct_b,
    efg_pct_diff: efg_pct_a - efg_pct_b,

    tov_rate_a,
    tov_rate_b,
    tov_rate_diff: tov_rate_b - tov_rate_a,  // inverted: positive = A advantage (B turns it over more)

    reb_margin_a,
    reb_margin_b,
    reb_margin_diff: reb_margin_a - reb_margin_b,

    ftr_a,
    ftr_b,
    ftr_diff: ftr_a - ftr_b,

    // Shooting breakdown (decimal differentials)
    three_pct_diff,
    ft_pct_diff,

    // Possession outcomes (per-game season averages)
    ast_diff: statsA.assistsPerGame - statsB.assistsPerGame,
    stl_diff: statsA.stealsPerGame  - statsB.stealsPerGame,
    blk_diff: statsA.blocksPerGame  - statsB.blocksPerGame,
  };
}
