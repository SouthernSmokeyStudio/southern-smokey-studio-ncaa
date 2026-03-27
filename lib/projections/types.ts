// lib/projections/types.ts
// Projection contract types — governed by MANIFESTO.md.
// v0.2: inputs changed from single-game boxscore to season-level team averages.

import type { CanonicalTeam, SeasonTeamStats } from "@/lib/types";

// ---------------------------------------------------------------------------
// PreparedGameInputs — output of prepareGameInputs.ts
// Carries validated season stats for both teams.
// ---------------------------------------------------------------------------

export interface TeamInput {
  id: string;               // seoname
  name: string;
  canonicalTeam: CanonicalTeam;
  stats: SeasonTeamStats;   // v0.2: season averages (was RawTeamStats / single-game boxscore)
}

export interface PreparedGameInputs {
  game_id: string;
  team_a: TeamInput;        // teams[0] from SlateGame
  team_b: TeamInput;        // teams[1] from SlateGame
}

// ---------------------------------------------------------------------------
// FeatureSet — output of engineerFeatures.ts
// All values are team_a perspective: positive = team_a advantage.
// All features derived from confirmed season-average stats endpoints.
//
// v0.2 change: oreb_rate_a/b/diff replaced by reb_margin_a/b/diff.
//   OREB is not available as a season stat in the NCAA API.
//   Rebound margin (RPG - OPP RPG) is the best available proxy.
//   pace_a/b removed — Hollinger pace requires single-game play-by-play data.
// ---------------------------------------------------------------------------

export interface FeatureSet {
  // --- Four Factors (Dean Oliver framework) ---

  // Effective field goal percentage: (FGM + 0.5×3FG) / FGA — season totals
  efg_pct_a: number;
  efg_pct_b: number;
  efg_pct_diff: number;       // efg_pct_a − efg_pct_b

  // Turnover rate: TO / (FGA + 0.44×FTA + TO) — season totals
  tov_rate_a: number;
  tov_rate_b: number;
  tov_rate_diff: number;      // tov_rate_b − tov_rate_a (inverted: positive = A advantage)

  // Rebound margin proxy: RPG − OPP RPG (replaces OREB rate; OREB not in NCAA stats API)
  reb_margin_a: number;       // team A rebound margin (RPG - OPP RPG)
  reb_margin_b: number;       // team B rebound margin
  reb_margin_diff: number;    // reb_margin_a − reb_margin_b

  // Free throw rate: FTM / FGA — season totals
  ftr_a: number;
  ftr_b: number;
  ftr_diff: number;           // ftr_a − ftr_b

  // --- Shooting breakdown ---

  // Three-point percentage differential (season average, decimal)
  three_pct_diff: number;     // threePointPct_a − threePointPct_b

  // Free throw percentage differential (season average, decimal)
  ft_pct_diff: number;        // freeThrowPct_a − freeThrowPct_b

  // --- Possession outcomes (per-game season averages) ---

  ast_diff: number;           // assistsPerGame_a − assistsPerGame_b
  stl_diff: number;           // stealsPerGame_a − stealsPerGame_b
  blk_diff: number;           // blocksPerGame_a − blocksPerGame_b
}

// ---------------------------------------------------------------------------
// PlayerProjection — projected output for one player in one game (v0.1)
// Baseline: player's most recent completed tournament game boxscore.
// Adjustments: minutes scaler based on projected game margin (garbage time).
// ---------------------------------------------------------------------------

export interface PlayerProjection {
  player_id: string;
  player_name: string;
  position: string;
  team_id: string;
  game_id: string;
  projection_status: "projected" | "blocked";
  projected_minutes: number | null;
  projected_points: number | null;
  projected_rebounds: number | null;
  projected_assists: number | null;
  projected_turnovers: number | null;
  projected_steals: number | null;
  projected_blocks: number | null;
  projected_dk_points: number | null;  // DraftKings fantasy scoring
  blocked_reason: string | null;
  model_version: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// TeamPlayerProjections — all projected players for one team in one game
// ---------------------------------------------------------------------------

export interface TeamPlayerProjections {
  game_id: string;
  team_id: string;
  team_name: string;
  game_projection: GameProjection;
  players: PlayerProjection[];
  projection_status: "projected" | "blocked";
  blocked_reason: string | null;
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

  // Which team is projected to win. Null when blocked or exact zero.
  projected_winner: "a" | "b" | null;

  // Confidence derived from projected margin magnitude.
  // low: |margin| < 5 | medium: 5–9 | high: ≥ 10
  // Null when blocked. Not statistically calibrated — v0.2 heuristic only.
  projection_confidence: "low" | "medium" | "high" | null;

  // Names of features that contributed to this projection.
  features_used: string[];

  // Numeric value of each feature at projection time.
  feature_values: Record<string, number>;

  // Semantic version of the projection model.
  model_version: string;

  // ISO 8601 timestamp of when this projection was computed.
  generated_at: string;

  // Human-readable explanation when projection_status is 'blocked'.
  blocked_reason: string | null;
}
