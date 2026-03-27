// lib/projections/projectMargin.ts
// v0.2 — Projection target: projected margin using season-level team averages.
//
// v0.2 changes from v0.1:
//   - Input: SlateGame (has season_stats_a/b) instead of CanonicalGame
//   - oreb_rate_diff replaced by reb_margin_diff (proxy; OREB unavailable in NCAA stats API)
//   - Coefficient for reb_margin_diff: 0.35 (rescaled from oreb_rate_diff's 14.0)
//     Rationale: reb_margin_diff is in RPG units (e.g., +5.0).
//     +10 RPG differential ≈ 3.5 pts projected impact → coefficient 0.35.
//   - pace removed (not computable from season averages)
//   - MODEL_VERSION bumped to v0.2-season
//
// Coefficients remain theory-grounded approximations. NOT empirically fitted.
// NOT backtested. Increment MODEL_VERSION when coefficients or feature set changes.
//
// Output is team_a perspective: positive projected_margin = team_a favored.

import type { PreparedGameInputs, GameProjection, FeatureSet } from "@/lib/projections/types";
import { engineerFeatures } from "@/lib/projections/engineerFeatures";

const MODEL_VERSION = "v0.2-season";

// ---------------------------------------------------------------------------
// Coefficients — v0.2 approximations, not fitted to data.
//
//   efg_pct_diff    decimal [−1,1]  × 55.0
//   tov_rate_diff   decimal [−1,1]  × 25.0
//   reb_margin_diff RPG diff        × 0.35   ← rescaled proxy for oreb_rate_diff
//     (was oreb_rate_diff × 14.0; reb_margin is in raw RPG, different scale)
//   ftr_diff        decimal [0,∞)   × 8.0
//   three_pct_diff  decimal [−1,1]  × 18.0
//   ft_pct_diff     decimal [−1,1]  × 5.0
//   ast_diff        avg per game    × 0.5
//   stl_diff        avg per game    × 1.2
//   blk_diff        avg per game    × 0.8
// ---------------------------------------------------------------------------

const COEFFICIENTS: Record<string, number> = {
  efg_pct_diff:    55.0,
  tov_rate_diff:   25.0,
  reb_margin_diff:  0.35,
  ftr_diff:         8.0,
  three_pct_diff:  18.0,
  ft_pct_diff:      5.0,
  ast_diff:         0.5,
  stl_diff:         1.2,
  blk_diff:         0.8,
};

const FORMULA_FEATURES = Object.keys(COEFFICIENTS);

// ---------------------------------------------------------------------------
// Confidence heuristic — v0.2 heuristic only, not statistically calibrated.
//   high:   |margin| ≥ 10
//   medium: |margin| ≥  5
//   low:    |margin| <  5
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
// projectMargin — core engine: PreparedGameInputs → GameProjection
// ---------------------------------------------------------------------------

export function projectMargin(inputs: PreparedGameInputs): GameProjection {
  const features = engineerFeatures(inputs.team_a.stats, inputs.team_b.stats);

  let projected_margin = 0;
  for (const key of FORMULA_FEATURES) {
    const featureVal = features[key as keyof FeatureSet] as number;
    projected_margin += COEFFICIENTS[key] * featureVal;
  }

  // Round to 1 decimal — false precision beyond that is misleading for v0.2.
  projected_margin = Math.round(projected_margin * 10) / 10;

  const projected_winner: GameProjection["projected_winner"] =
    projected_margin > 0 ? "a" :
    projected_margin < 0 ? "b" :
    null;

  // Include all FeatureSet values in feature_values for auditability
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
// projectGame — convenience wrapper: SlateGame → GameProjection
// Returns a blocked projection when prepareGameInputs fails.
// ---------------------------------------------------------------------------

import { prepareGameInputs } from "@/lib/projections/prepareGameInputs";
import type { SlateGame } from "@/lib/types";

export function projectGame(game: SlateGame): GameProjection {
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
