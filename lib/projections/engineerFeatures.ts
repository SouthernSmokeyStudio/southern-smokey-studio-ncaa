// lib/projections/engineerFeatures.ts
// Phase 3 — Feature engineering layer.
//
// Derives a FeatureSet from two validated RawTeamStats objects.
// Every feature is documented with:
//   - Formula
//   - Raw fields consumed
//   - Units
//   - Team_a perspective (positive = team_a advantage)
//
// No values are fabricated. Derived rates guard against division by zero
// by returning 0.0 when the denominator is absent — this is a structural
// edge (e.g. 0 FGA) that prepareGameInputs should have caught first.
//
// Feature framework: Dean Oliver's Four Factors, extended with possession
// outcomes. All features are tournament-agnostic.

import type { RawTeamStats } from "@/lib/types";
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
// Formula:  (FGM + 0.5 × 3PM) / FGA
// Units:    decimal [0, 1]
// Why:      weights a made 3-pointer at 1.5× a made 2-pointer, reflecting
//           that it produces 50% more points per make.
// Raw:      fieldGoalsMade, threePointsMade, fieldGoalsAttempted
// ---------------------------------------------------------------------------

function computeEfgPct(s: RawTeamStats): number {
  return safeDivide(s.fieldGoalsMade + 0.5 * s.threePointsMade, s.fieldGoalsAttempted);
}

// ---------------------------------------------------------------------------
// Turnover rate
// Formula:  TOV / (FGA + 0.44 × FTA + TOV)
// Units:    decimal [0, 1] — fraction of possessions ending in a turnover
// Why:      0.44 is the standard coefficient converting FTA to possession
//           estimates (accounts for and-ones, technical FTs, etc.).
// Raw:      turnovers, fieldGoalsAttempted, freeThrowsAttempted
// ---------------------------------------------------------------------------

function computeTovRate(s: RawTeamStats): number {
  const denom = s.fieldGoalsAttempted + 0.44 * s.freeThrowsAttempted + s.turnovers;
  return safeDivide(s.turnovers, denom);
}

// ---------------------------------------------------------------------------
// Offensive rebounding rate
// Formula:  OREB / (OREB + opp_DREB)
//           where opp_DREB = opponent.totalRebounds − opponent.offensiveRebounds
// Units:    decimal [0, 1] — fraction of available offensive boards captured
// Why:      measures second-chance opportunity creation relative to what was
//           available, not the absolute count.
// Raw:      offensiveRebounds (team), totalRebounds and offensiveRebounds (opp)
// ---------------------------------------------------------------------------

function computeOrebRate(team: RawTeamStats, opponent: RawTeamStats): number {
  const oppDreb = opponent.totalRebounds - opponent.offensiveRebounds;
  return safeDivide(team.offensiveRebounds, team.offensiveRebounds + oppDreb);
}

// ---------------------------------------------------------------------------
// Free throw rate
// Formula:  FTM / FGA
// Units:    decimal [0, +∞) — typically 0.10 to 0.45 in practice
// Why:      measures ability to get to the line and convert; using FTM (not
//           FTA) captures both drawing fouls AND converting them.
// Raw:      freeThrowsMade, fieldGoalsAttempted
// ---------------------------------------------------------------------------

function computeFtr(s: RawTeamStats): number {
  return safeDivide(s.freeThrowsMade, s.fieldGoalsAttempted);
}

// ---------------------------------------------------------------------------
// Pace proxy (Hollinger single-game estimate)
// Formula:  FGA − OREB + TOV + 0.44 × FTA
// Units:    estimated possessions (raw count)
// Why:      approximates number of possessions without play-by-play data.
//           Not season-adjusted — meaningful only relative to the opponent
//           in the same game.
// Raw:      fieldGoalsAttempted, offensiveRebounds, turnovers, freeThrowsAttempted
// ---------------------------------------------------------------------------

function computePace(s: RawTeamStats): number {
  return s.fieldGoalsAttempted - s.offensiveRebounds + s.turnovers + 0.44 * s.freeThrowsAttempted;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function engineerFeatures(
  statsA: RawTeamStats,
  statsB: RawTeamStats
): FeatureSet {
  // Compute per-team rates
  const efg_pct_a = computeEfgPct(statsA);
  const efg_pct_b = computeEfgPct(statsB);

  const tov_rate_a = computeTovRate(statsA);
  const tov_rate_b = computeTovRate(statsB);

  const oreb_rate_a = computeOrebRate(statsA, statsB);
  const oreb_rate_b = computeOrebRate(statsB, statsA);

  const ftr_a = computeFtr(statsA);
  const ftr_b = computeFtr(statsB);

  const pace_a = computePace(statsA);
  const pace_b = computePace(statsB);

  // threePointPercentage and freeThrowPercentage are stored as 0–100 floats
  // in RawTeamStats (e.g. 37.5 means 37.5%). Convert to decimal for consistent
  // units before computing diff.
  const three_pct_diff =
    safeDivide(statsA.threePointPercentage - statsB.threePointPercentage, 100);

  const ft_pct_diff =
    safeDivide(statsA.freeThrowPercentage - statsB.freeThrowPercentage, 100);

  return {
    // Four Factors
    efg_pct_a,
    efg_pct_b,
    efg_pct_diff: efg_pct_a - efg_pct_b,

    tov_rate_a,
    tov_rate_b,
    tov_rate_diff: tov_rate_b - tov_rate_a,   // inverted: positive = A advantage

    oreb_rate_a,
    oreb_rate_b,
    oreb_rate_diff: oreb_rate_a - oreb_rate_b,

    ftr_a,
    ftr_b,
    ftr_diff: ftr_a - ftr_b,

    // Shooting breakdown (decimal differentials)
    three_pct_diff,
    ft_pct_diff,

    // Possession outcomes (raw count differentials)
    ast_diff: statsA.assists - statsB.assists,
    stl_diff: statsA.steals - statsB.steals,
    blk_diff: statsA.blockedShots - statsB.blockedShots,

    // Pace
    pace_a,
    pace_b,
  };
}
