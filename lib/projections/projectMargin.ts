// lib/projections/projectMargin.ts
// Phase 2 — First projection target: projected margin.
//
// Accepts validated PreparedGameInputs, engineers features, and returns a
// complete GameProjection.
//
// Model: v0.1 — deterministic linear combination of engineered features.
// Coefficients are theory-grounded approximations from basketball efficiency
// literature (Dean Oliver's Four Factors framework).
//
// NOT empirically fitted. NOT backtested. Coefficients labeled explicitly.
// Increment MODEL_VERSION when coefficients or feature set changes.
//
// Output is team_a perspective: positive projected_margin = team_a favored.

import type { PreparedGameInputs, GameProjection, FeatureSet } from "@/lib/projections/types";
import { engineerFeatures } from "@/lib/projections/engineerFeatures";

const MODEL_VERSION = "v0.1-linear";

// ---------------------------------------------------------------------------
// Coefficients — v0.1 approximations, not fitted to data.
//
// Units and rationale:
//
//   efg_pct_diff    decimal [−1,1]  × 55.0
//     eFG% is the single strongest predictor of offensive efficiency.
//     A 0.01 improvement in eFG% ≈ ~0.5–0.6 pts given ~70–75 possessions/game.
//     At 0.01 × 55 = 0.55 pts — directionally correct.
//
//   tov_rate_diff   decimal [−1,1]  × 25.0
//     Each extra possession generated through opponent TOs ≈ ~1 pt expected value.
//     tov_rate ≈ 0.14 league average; 0.01 improvement × 25 = 0.25 pts.
//
//   oreb_rate_diff  decimal [−1,1]  × 14.0
//     Each second-chance possession ≈ 0.9–1.1 pts.
//     oreb_rate ≈ 0.28 average; 0.01 improvement × 14 = 0.14 pts.
//
//   ftr_diff        decimal [0,∞)   × 8.0
//     Free throws ≈ 0.75 pts each; FTR measures both drawing fouls and
//     converting. 0.01 FTR improvement × 8 = 0.08 pts.
//
//   three_pct_diff  decimal [−1,1]  × 18.0
//     Complementary to eFG; captures perimeter efficiency signal not fully
//     absorbed by eFG when teams have different 3PA rates.
//
//   ft_pct_diff     decimal [−1,1]  × 5.0
//     Modest weight — FT% single-game variance is high.
//
//   ast_diff        raw count        × 0.5
//     Assists proxy ball-movement quality; each extra assist ≈ 0.3–0.5 pts.
//
//   stl_diff        raw count        × 1.2
//     Each steal ≈ 1 guaranteed extra possession + demoralisation effect.
//
//   blk_diff        raw count        × 0.8
//     Blocks prevent scores but do not guarantee possession (out of bounds).
// ---------------------------------------------------------------------------

const COEFFICIENTS: Record<keyof Omit<FeatureSet, "efg_pct_a" | "efg_pct_b" | "tov_rate_a" | "tov_rate_b" | "oreb_rate_a" | "oreb_rate_b" | "ftr_a" | "ftr_b" | "pace_a" | "pace_b" | "ft_pct_diff">, number> & Record<string, number> = {
  efg_pct_diff:   55.0,
  tov_rate_diff:  25.0,
  oreb_rate_diff: 14.0,
  ftr_diff:        8.0,
  three_pct_diff: 18.0,
  ft_pct_diff:     5.0,
  ast_diff:        0.5,
  stl_diff:        1.2,
  blk_diff:        0.8,
};

// The set of features that feed the margin formula (not all FeatureSet fields).
const FORMULA_FEATURES = Object.keys(COEFFICIENTS) as (keyof typeof COEFFICIENTS)[];

// ---------------------------------------------------------------------------
// Confidence heuristic — based solely on projected margin magnitude.
// NOT statistically calibrated. v0.1 heuristic only.
//   high:   |margin| ≥ 10 — large statistical separation
//   medium: |margin| ≥  5 — moderate separation
//   low:    |margin| <  5 — close game, high uncertainty
// ---------------------------------------------------------------------------

function computeConfidence(
  margin: number
): GameProjection["projection_confidence"] {
  const abs = Math.abs(margin);
  if (abs >= 10) return "high";
  if (abs >= 5)  return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function projectMargin(inputs: PreparedGameInputs): GameProjection {
  const features = engineerFeatures(inputs.team_a.stats, inputs.team_b.stats);

  // Compute margin as weighted sum of formula features only.
  // Per-team rates (efg_pct_a, tov_rate_a, etc.) and pace are in FeatureSet
  // for inspection/debugging but are not direct formula inputs.
  let projected_margin = 0;
  for (const key of FORMULA_FEATURES) {
    const featureVal = features[key as keyof FeatureSet] as number;
    projected_margin += COEFFICIENTS[key] * featureVal;
  }

  // Round to 1 decimal — false precision beyond that is misleading for v0.1.
  projected_margin = Math.round(projected_margin * 10) / 10;

  const projected_winner: GameProjection["projected_winner"] =
    projected_margin > 0 ? "a" :
    projected_margin < 0 ? "b" :
    null; // exact zero — genuinely indeterminate

  // Build feature_values: include per-team rates + diff values for auditability.
  const feature_values: Record<string, number> = {};
  for (const key of Object.keys(features) as (keyof FeatureSet)[]) {
    feature_values[key] = features[key];
  }

  return {
    game_id: inputs.game_id,
    projection_status: "projected",
    projected_margin,
    projected_winner,
    projection_confidence: computeConfidence(projected_margin),
    features_used: FORMULA_FEATURES,
    feature_values,
    model_version: MODEL_VERSION,
    generated_at: new Date().toISOString(),
    blocked_reason: null,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run the full pipeline from CanonicalGame to GameProjection.
// Returns a blocked projection when prepareGameInputs fails.
// ---------------------------------------------------------------------------

import { prepareGameInputs } from "@/lib/projections/prepareGameInputs";
import type { CanonicalGame } from "@/lib/types";

export function projectGame(game: CanonicalGame): GameProjection {
  const { inputs, blocked_reason } = prepareGameInputs(game);

  if (!inputs || blocked_reason) {
    return {
      game_id: game.game_id,
      projection_status: "blocked",
      projected_margin: null,
      projected_winner: null,
      projection_confidence: null,
      features_used: [],
      feature_values: {},
      model_version: MODEL_VERSION,
      generated_at: new Date().toISOString(),
      blocked_reason: blocked_reason ?? "prepareGameInputs returned null without a reason",
    };
  }

  return projectMargin(inputs);
}
