// CanonicalGame Contract — governed by MANIFESTO.md
// Field names for team_stats_raw and player_stats_raw are defined solely
// by live API inspection (completed Step 1, game 6595954 /boxscore).
// DO NOT add third-party rating fields. DO NOT import external ranking types.

// ---------------------------------------------------------------------------
// Game status
// ---------------------------------------------------------------------------

export type LiveStatus = "scheduled" | "live" | "final";

// ---------------------------------------------------------------------------
// Team identity (bracket / scoreboard layer)
// ---------------------------------------------------------------------------

export interface CanonicalTeam {
  id: string;
  name: string;
  seed: string | null;
  score: number | null;
  winner: boolean;
}

// ---------------------------------------------------------------------------
// Raw player stats — sourced exclusively from /boxscore playerStats[]
// All fields that arrive as strings from the API are typed as number here.
// Adapters are responsible for string-to-number parsing. Fail closed on null.
// ---------------------------------------------------------------------------

export interface RawPlayerStats {
  id: number;
  number: number;
  firstName: string;
  lastName: string;
  position: string;
  minutesPlayed: number;
  year: string;
  elig: string;
  starter: boolean;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  threePointsMade: number;
  threePointsAttempted: number;
  offensiveRebounds: number;
  totalRebounds: number;
  assists: number;
  turnovers: number;
  personalFouls: number;
  steals: number;
  blockedShots: number;
  points: number;
}

// ---------------------------------------------------------------------------
// Raw team stats — sourced exclusively from /boxscore teamStats
// Superset of player stat fields plus the three percentage strings.
// Percentage fields arrive as strings (e.g. "30.2%") — adapters strip "%"
// and parse to number. Fail closed on null.
// ---------------------------------------------------------------------------

export interface RawTeamStats {
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  fieldGoalPercentage: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  freeThrowPercentage: number;
  threePointsMade: number;
  threePointsAttempted: number;
  threePointPercentage: number;
  offensiveRebounds: number;
  totalRebounds: number;
  assists: number;
  turnovers: number;
  personalFouls: number;
  steals: number;
  blockedShots: number;
  points: number;
}

// ---------------------------------------------------------------------------
// CanonicalGame — immutable contract per MANIFESTO.md §4
// team_stats_raw and player_stats_raw are keyed by teamId (string).
// ---------------------------------------------------------------------------

export interface CanonicalGame {
  game_id: string;
  status: LiveStatus;
  description: string;
  teams: CanonicalTeam[];
  team_stats_raw: Record<string, RawTeamStats>;    // keyed by teamId
  player_stats_raw: Record<string, RawPlayerStats[]>; // keyed by teamId
  stale: boolean;                                  // true when source returned error
  last_synced: string | null;                      // ISO 8601 timestamp or null before first sync
}

// ---------------------------------------------------------------------------
// SeasonTeamStats — season-level team averages from NCAA stats endpoints.
// Sourced from /stats/basketball-men/d1/{year}/team/{id}.
// Used as projection inputs instead of single-game boxscore stats.
// All percentage fields stored as decimals (e.g. 0.451, not 45.1).
// ---------------------------------------------------------------------------

export interface SeasonTeamStats {
  // Source: endpoint 148 (Field Goal %)
  gamesPlayed: number;
  fieldGoalsMade: number;          // season total
  fieldGoalsAttempted: number;     // season total — must be > 0 to compute rates
  fieldGoalPct: number;            // decimal (FG% / 100)

  // Source: endpoint 150 (Free Throw %)
  freeThrowsMade: number;          // season total
  freeThrowsAttempted: number;     // season total
  freeThrowPct: number;            // decimal (FT% / 100)

  // Source: endpoint 151 (Rebound Margin)
  // OREB not directly available in NCAA stats API — rebound margin is the proxy.
  reboundsPerGame: number;
  oppReboundsPerGame: number;
  reboundMargin: number;           // RPG − OPP RPG

  // Source: endpoint 152 (Three Point %)
  threesMade: number;              // season total — used in eFG% formula
  threesAttempted: number;         // season total
  threePointPct: number;           // decimal (3FG% / 100)

  // Source: endpoint 214 (Blocks/Game)
  blocksPerGame: number;

  // Source: endpoint 215 (Steals/Game)
  stealsPerGame: number;

  // Source: endpoint 216 (Assists/Game)
  assistsPerGame: number;

  // Source: endpoint 217 (Turnovers/Game)
  turnoversTotal: number;          // season total — used in TOV rate formula
  turnoversPerGame: number;

  // Source: endpoint 145 (Scoring Offense)
  pointsPerGame: number;           // PPG season average
}

// ---------------------------------------------------------------------------
// SlateGame — CanonicalGame + bracket/scoreboard structural fields
// These fields come from confirmed API output (bracketAdapter, scoreboardAdapter).
// CanonicalGame itself remains the immutable manifesto contract.
// SlateGame is what /api/sss/slate actually emits — a superset.
// ---------------------------------------------------------------------------

export interface SlateGame extends CanonicalGame {
  bracketRound: number | null;      // Confirmed: scoreboard game.bracketRound
  sectionId: number | null;         // Confirmed: bracket game.sectionId (maps to region)
  startDate: string | null;         // Confirmed: bracket game.startDate ("MM/DD/YYYY")
  startTimeEpoch: number | null;    // Confirmed: bracket + scoreboard game.startTimeEpoch
  network: string | null;           // Confirmed: scoreboard game.network
  broadcaster: string | null;       // Confirmed: bracket game.broadcaster.name
  season_stats_a: SeasonTeamStats | null;  // season averages for teams[0], keyed by seoname
  season_stats_b: SeasonTeamStats | null;  // season averages for teams[1], keyed by seoname
}

// ---------------------------------------------------------------------------
// SlateResponse — shape emitted by /api/sss/slate
// ---------------------------------------------------------------------------

export interface SlateResponse {
  status: "ok" | "partial" | "error";
  syncedAt: string;         // ISO 8601 timestamp of this response
  sources: string[];        // API endpoints actually called
  errors: string[];         // Empty array when status is "ok"
  games: SlateGame[];
}
