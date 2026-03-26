// teamStatsAdapter.ts
// Pass-through that extracts team_stats_raw from boxscoreAdapter.
// Does NOT call /team-stats endpoint — confirmed unreliable in Step 1
// (response returned inverted team assignment for game 6595954).
// Single source is /game/{id}/boxscore via boxscoreAdapter.

import { fetchBoxscore } from "@/lib/adapters/boxscoreAdapter";
import type { RawTeamStats } from "@/lib/types";

export async function fetchTeamStats(
  gameId: string
): Promise<Record<string, RawTeamStats> | null> {
  const result = await fetchBoxscore(gameId);
  if (!result) {
    console.warn(
      `[teamStatsAdapter] boxscoreAdapter returned null for game ${gameId}`
    );
    return null;
  }

  if (Object.keys(result.team_stats_raw).length === 0) {
    console.warn(
      `[teamStatsAdapter] no team_stats_raw entries for game ${gameId}`
    );
    return null;
  }

  return result.team_stats_raw;
}
