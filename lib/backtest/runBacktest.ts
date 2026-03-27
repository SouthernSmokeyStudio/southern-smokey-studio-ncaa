// lib/backtest/runBacktest.ts
//
// Backtesting framework for the game projection engine.
//
// Method:
//   For each completed tournament game that has season stats attached:
//     1. Run projectGame() — same function used for forward projections
//     2. Compare projected_winner to actual winner (game.teams[n].winner)
//     3. Compare projected_margin to actual margin (scoreA - scoreB)
//     4. Accumulate results
//
// Temporal integrity:
//   Season stats (via /stats/basketball-men/d1/{year}/team/{id}) are fetched
//   from the current NCAA endpoint, which includes data through March 25, 2026.
//   Tournament games played before that date may appear in the season averages
//   used as projection inputs, introducing minor forward leakage.
//   True holdout backtesting requires pre-tournament stat snapshots.
//   The NCAA stats API does not expose historical snapshots.
//   All results must be interpreted with this caveat.
//
// Usage:
//   import { runBacktest } from "@/lib/backtest/runBacktest";
//   const summary = runBacktest(slate.games);

import type { SlateGame } from "@/lib/types";
import { projectGame } from "@/lib/projections/projectMargin";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface BacktestRecord {
  game_id: string;
  teamAName: string;
  teamBName: string;
  // Projection outputs
  projected_winner: "a" | "b" | null;
  projected_margin: number;
  projection_confidence: "low" | "medium" | "high";
  model_version: string;
  // Actual outcomes
  actual_winner: "a" | "b" | null;   // null when winner flag absent in data
  actual_margin: number | null;       // null when scores absent
  // Derived
  is_correct: boolean | null;         // null when pick_em or winner unknown
  margin_error: number | null;        // |projected_margin - actual_margin|
  signed_error: number | null;        // projected_margin - actual_margin
                                      // positive = over-projected team_a, negative = under-projected
}

export interface ConfidenceSplit {
  count: number;
  correct: number;           // games where is_correct === true
  accuracy: number | null;   // correct / games_with_decidable_winner
  mae: number | null;        // mean absolute margin error for this tier
  mean_signed_error: number | null; // positive = over-projecting margins on average
}

export interface BacktestSummary {
  model_version: string;
  run_at: string;

  // Coverage
  total_games_in_slate: number;
  games_with_season_stats: number;  // final games with season_stats_a/b attached
  games_projected: number;          // projection_status === "projected"
  games_blocked: number;

  // Winner accuracy
  games_with_winner: number;        // actual winner determinable
  winner_correct: number;
  winner_accuracy: number | null;   // null when no games with winner

  // Margin accuracy
  games_with_score: number;         // actual scores present
  mae: number | null;
  mean_signed_error: number | null; // positive = systematically over-projecting margins

  // Breakdown by confidence tier
  by_confidence: Record<"low" | "medium" | "high", ConfidenceSplit>;

  // Top 5 biggest margin misses
  biggest_misses: BacktestRecord[];

  // All records (for full results table)
  results: BacktestRecord[];

  // Temporal leakage warning — must be displayed in any UI
  leakage_warning: string;
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

export function runBacktest(games: SlateGame[]): BacktestSummary {
  // Only use completed games with season stats on both teams
  const eligible = games.filter(
    (g) =>
      g.status === "final" &&
      g.season_stats_a !== null &&
      g.season_stats_b !== null
  );

  const results: BacktestRecord[] = [];

  for (const game of eligible) {
    const projection = projectGame(game);

    // Actual winner — use the winner flag from the canonical teams array
    const teamAWon = game.teams[0]?.winner ?? false;
    const teamBWon = game.teams[1]?.winner ?? false;
    const actualWinner: "a" | "b" | null =
      teamAWon ? "a" : teamBWon ? "b" : null;

    // Actual margin (team_a perspective: positive = team_a won)
    const scoreA = game.teams[0]?.score ?? null;
    const scoreB = game.teams[1]?.score ?? null;
    const actualMargin =
      scoreA !== null && scoreB !== null ? scoreA - scoreB : null;

    // Correctness — null when pick_em or actual winner unknown
    let isCorrect: boolean | null = null;
    if (projection.projected_winner !== null && actualWinner !== null) {
      isCorrect = projection.projected_winner === actualWinner;
    }

    const projectedMargin = projection.projected_margin ?? 0;

    const marginError =
      actualMargin !== null
        ? Math.abs(projectedMargin - actualMargin)
        : null;

    const signedError =
      actualMargin !== null ? projectedMargin - actualMargin : null;

    results.push({
      game_id: game.game_id,
      teamAName: game.teams[0]?.name ?? "Team A",
      teamBName: game.teams[1]?.name ?? "Team B",
      projected_winner: projection.projected_winner,
      projected_margin: projectedMargin,
      projection_confidence: projection.projection_confidence ?? "low",
      model_version: projection.model_version,
      actual_winner: actualWinner,
      actual_margin: actualMargin,
      is_correct: isCorrect,
      margin_error: marginError,
      signed_error: signedError,
    });
  }

  // ---------------------------------------------------------------------------
  // Aggregation helpers
  // ---------------------------------------------------------------------------

  function aggregate(subset: BacktestRecord[]): ConfidenceSplit {
    const withWinner = subset.filter((r) => r.is_correct !== null);
    const correct    = withWinner.filter((r) => r.is_correct === true);
    const withScore  = subset.filter((r) => r.margin_error !== null);

    const mae =
      withScore.length > 0
        ? withScore.reduce((s, r) => s + (r.margin_error ?? 0), 0) / withScore.length
        : null;

    const mse =
      withScore.length > 0
        ? withScore.reduce((s, r) => s + (r.signed_error ?? 0), 0) / withScore.length
        : null;

    return {
      count:             subset.length,
      correct:           correct.length,
      accuracy:          withWinner.length > 0 ? correct.length / withWinner.length : null,
      mae,
      mean_signed_error: mse,
    };
  }

  // Overall metrics
  const withWinner = results.filter((r) => r.is_correct !== null);
  const correct    = withWinner.filter((r) => r.is_correct === true);
  const withScore  = results.filter((r) => r.margin_error !== null);

  const mae =
    withScore.length > 0
      ? withScore.reduce((s, r) => s + (r.margin_error ?? 0), 0) / withScore.length
      : null;

  const meanSignedError =
    withScore.length > 0
      ? withScore.reduce((s, r) => s + (r.signed_error ?? 0), 0) / withScore.length
      : null;

  // By confidence tier
  const byConf: Record<"low" | "medium" | "high", BacktestRecord[]> = {
    low: [], medium: [], high: [],
  };
  for (const r of results) {
    byConf[r.projection_confidence].push(r);
  }

  // Top 5 biggest misses
  const biggestMisses = [...results]
    .filter((r) => r.margin_error !== null)
    .sort((a, b) => (b.margin_error ?? 0) - (a.margin_error ?? 0))
    .slice(0, 5);

  const projectedCount = results.filter((r) => r.projected_winner !== null).length;

  return {
    model_version:          results[0]?.model_version ?? "v0.2-season",
    run_at:                 new Date().toISOString(),
    total_games_in_slate:   games.length,
    games_with_season_stats: eligible.length,
    games_projected:        projectedCount,
    games_blocked:          eligible.length - projectedCount,
    games_with_winner:      withWinner.length,
    winner_correct:         correct.length,
    winner_accuracy:        withWinner.length > 0 ? correct.length / withWinner.length : null,
    games_with_score:       withScore.length,
    mae,
    mean_signed_error:      meanSignedError,
    by_confidence: {
      low:    aggregate(byConf.low),
      medium: aggregate(byConf.medium),
      high:   aggregate(byConf.high),
    },
    biggest_misses: biggestMisses,
    results,
    leakage_warning:
      "CAUTION — minor forward leakage: season stats (updated March 25, 2026) include " +
      "tournament games already played. Each tournament game contributes ~3–5% weight " +
      "to season averages for a typical 30-35 game season. True temporal holdout requires " +
      "pre-tournament stat snapshots, which are unavailable from the NCAA stats API. " +
      "Results are directionally valid but accuracy figures are optimistically biased.",
  };
}

// ---------------------------------------------------------------------------
// Coefficient recommendation engine
// Interprets backtest summary and emits human-readable calibration guidance.
// These are heuristic rules, not statistical fits.
// ---------------------------------------------------------------------------

export interface CoefficientRecommendation {
  feature: string;
  current_coefficient: number;
  direction: "increase" | "decrease" | "hold";
  reasoning: string;
}

export function deriveRecommendations(
  summary: BacktestSummary
): CoefficientRecommendation[] {
  const recs: CoefficientRecommendation[] = [];
  const { mean_signed_error, mae, winner_accuracy, by_confidence } = summary;

  if (mean_signed_error === null || mae === null || winner_accuracy === null) {
    return [];
  }

  // Global scale: if mean_signed_error > +3, model is systematically over-projecting
  // margins — all coefficients should shrink proportionally
  const globalBias =
    mean_signed_error > 3
      ? "decrease"
      : mean_signed_error < -3
      ? "increase"
      : "hold";

  if (globalBias !== "hold") {
    recs.push({
      feature: "ALL (global scale)",
      current_coefficient: NaN,
      direction: globalBias,
      reasoning:
        `Mean signed error = ${mean_signed_error.toFixed(1)} pts. ` +
        (globalBias === "decrease"
          ? "Model is projecting margins that are too large on average. Consider applying a global deflation factor (e.g. multiply all coefficients by 0.85)."
          : "Model is projecting margins that are too small on average. Consider a global inflation factor."),
    });
  }

  // Confidence calibration: high-confidence picks should outperform low-confidence
  const highAcc   = by_confidence.high.accuracy   ?? 0;
  const medAcc    = by_confidence.medium.accuracy  ?? 0;
  const lowAcc    = by_confidence.low.accuracy     ?? 0;

  if (
    by_confidence.high.count > 0 &&
    by_confidence.low.count > 0 &&
    highAcc <= lowAcc
  ) {
    recs.push({
      feature: "confidence thresholds (|margin| ≥ 10 = high, ≥ 5 = medium)",
      current_coefficient: NaN,
      direction: "decrease",
      reasoning:
        `High-confidence accuracy (${(highAcc * 100).toFixed(0)}%) ≤ low-confidence ` +
        `(${(lowAcc * 100).toFixed(0)}%). Confidence tiers are not predictive of actual correctness. ` +
        `Raise the 'high' threshold (currently ≥10 pts) or reduce coefficients to compress projected margins.`,
    });
  }

  // MAE interpretation
  if (mae > 12) {
    recs.push({
      feature: "overall model",
      current_coefficient: NaN,
      direction: "decrease",
      reasoning:
        `MAE = ${mae.toFixed(1)} pts. NCAA tournament games average ~10 pt margin variation. ` +
        `Error > 12 pts indicates the feature set or coefficients need significant recalibration. ` +
        `Consider reducing the two highest-weight coefficients (efg_pct_diff × 55, tov_rate_diff × 25).`,
    });
  } else if (mae < 6) {
    recs.push({
      feature: "overall model",
      current_coefficient: NaN,
      direction: "hold",
      reasoning:
        `MAE = ${mae.toFixed(1)} pts. Strong result for a theory-grounded model with no empirical fitting. ` +
        `Hold current coefficients until a larger sample is available.`,
    });
  }

  // Winner accuracy interpretation
  if (winner_accuracy < 0.5) {
    recs.push({
      feature: "overall model (direction)",
      current_coefficient: NaN,
      direction: "decrease",
      reasoning:
        `Winner accuracy = ${(winner_accuracy * 100).toFixed(0)}%, below coin-flip baseline. ` +
        `Review whether season stats are stale or mismatched for these specific teams. ` +
        `Check blocked_reason counts — high block rate means fewer games are being projected.`,
    });
  } else if (winner_accuracy > 0.68) {
    recs.push({
      feature: "overall model (direction)",
      current_coefficient: NaN,
      direction: "hold",
      reasoning:
        `Winner accuracy = ${(winner_accuracy * 100).toFixed(0)}%. Competitive with published ` +
        `NCAA prediction models (typical range: 65–75%). Hold pending larger sample.`,
    });
  }

  return recs;
}
