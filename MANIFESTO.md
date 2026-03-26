# SSS NCAA CBB App — Master Manifesto

## 1. Top 1% Standard
Top 1% is not talent. It is the absence of leftover effort. Nothing useful goes unused. Nothing obvious gets skipped. Nothing halfway gets renamed done. [cite: 2, 3, 4]

## 2. The Single Source of Truth
The raw NCAA API is the only valid input. We reject the "completion at all costs" approach. If data is missing, the UI shows an honest "blocked" state. We do not impute. We do not fabricate.

## 3. Prohibited Entities
Bart Torvik, Warren Nolan, and all rating-based schemas are strictly prohibited. The application relies exclusively on raw performance data. External opinions or third-party rankings have no place in the Canonical state.

## 4. The CanonicalGame Contract
Every game must map to this exact immutable contract. Field names for `team_stats_raw` and `player_stats_raw` will be defined solely by the live API inspection.

interface CanonicalGame {
  game_id: string;
  team_stats_raw: Record<string, any>;   // Raw capture from NCAA Team API
  player_stats_raw: Record<string, any>; // Raw capture from NCAA Boxscore API
  stale: boolean;                        // Status flag for API errors
  last_synced: string;                   // ISO 8601 Timestamp
}

## 5. Adapter Law
All adapters (bracket, scoreboard, game, boxscore, teamStats, ncaaStats) operate on "Fail-Closed" logic. If a field is missing, return null. The `/api/sss/slate` endpoint emits only validated CanonicalGame objects.
