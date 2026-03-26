// /api/sss/slate — single endpoint consumed by the entire frontend
//
// Orchestration order:
//   1. bracketAdapter   → tournament structure (required — fail = error)
//   2. scoreboardAdapter → live scores / status  (optional — fail = partial)
//   3. boxscoreAdapter  → player + team stats    (per final/live game — fail = stale game, not slate error)
//
// Caching:
//   - Last successful slate per year stored in module-level Map
//   - On total source failure, serve cache with stale: true on every game
//   - On partial source failure, merge fresh data with cached data for failed sources
//   - ?refresh=true bypasses cache and forces fresh fetch from all sources
//
// No Torvik. No Warren. No rating columns. Raw-stats-first only.

import { fetchBracket } from "@/lib/adapters/bracketAdapter";
import { fetchScoreboard } from "@/lib/adapters/scoreboardAdapter";
import { fetchBoxscore } from "@/lib/adapters/boxscoreAdapter";
import type { CanonicalTeam, SlateGame, SlateResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  response: SlateResponse;
  cachedAt: string; // ISO 8601
}

const slateCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markAllStale(games: SlateGame[], cachedAt: string): SlateGame[] {
  return games.map((g) => ({ ...g, stale: true, last_synced: cachedAt }));
}

/** Overlay scoreboard status, scores, and display fields onto a bracket-sourced game. */
function overlayScoreboard(
  base: SlateGame,
  sbTeams: CanonicalTeam[],
  sbStatus: SlateGame["status"],
  network: string | null
): SlateGame {
  const updatedTeams = base.teams.map((bt) => {
    const match = sbTeams.find((st) => st.id === bt.id);
    if (!match) return bt;
    return {
      ...bt,
      score: match.score,
      winner: match.winner,
    };
  });

  return {
    ...base,
    status: sbStatus,
    teams: updatedTeams,
    network: network ?? base.network,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const year = searchParams.get("year");
  const forceRefresh = searchParams.get("refresh") === "true";

  if (!year || !/^\d{4}$/.test(year)) {
    return Response.json(
      {
        status: "error",
        syncedAt: new Date().toISOString(),
        sources: [],
        errors: ["year parameter is required and must be a 4-digit integer"],
        games: [],
      } satisfies SlateResponse,
      { status: 400 }
    );
  }

  const cached = slateCache.get(year);

  // -------------------------------------------------------------------------
  // Step 1 — Bracket (required source)
  // -------------------------------------------------------------------------

  const bracketGames = await fetchBracket(parseInt(year, 10));

  if (!bracketGames) {
    console.warn(`[slate] bracketAdapter returned null for year ${year}`);

    if (cached) {
      // Serve cache with stale flag — bracket is the backbone; without it we cannot merge
      const staleGames = markAllStale(cached.response.games, cached.cachedAt);
      return Response.json({
        ...cached.response,
        status: "error",
        syncedAt: new Date().toISOString(),
        errors: [
          "bracketAdapter returned null — serving cached slate",
          ...cached.response.errors,
        ],
        games: staleGames,
      } satisfies SlateResponse);
    }

    return Response.json(
      {
        status: "error",
        syncedAt: new Date().toISOString(),
        sources: [],
        errors: ["bracketAdapter returned null — no cache available"],
        games: [],
      } satisfies SlateResponse
    );
  }

  // Build working game map keyed by game_id — bracket is the base layer.
  // Preserve bracket structural fields (sectionId, bracketRound, etc.) for the UI.
  const gameMap = new Map<string, SlateGame>();
  for (const bg of bracketGames) {
    const slateGame: SlateGame = {
      game_id: bg.game_id,
      status: bg.status,
      description: bg.description,
      teams: bg.teams,
      team_stats_raw: bg.team_stats_raw,
      player_stats_raw: bg.player_stats_raw,
      stale: bg.stale,
      last_synced: bg.last_synced,
      bracketRound: null,     // populated only via scoreboard overlay (bracketAdapter has no round number)
      sectionId: bg.sectionId,
      startDate: bg.startDate,
      startTimeEpoch: bg.startTimeEpoch,
      network: bg.broadcaster,              // bracket has broadcaster; scoreboard will overlay network
      broadcaster: bg.broadcaster,
    };
    gameMap.set(bg.game_id, slateGame);
  }

  const sources: string[] = [
    `https://ncaa-api.henrygd.me/brackets/basketball-men/d1/${year}`,
  ];
  const errors: string[] = [];
  let overallStatus: SlateResponse["status"] = "ok";

  // -------------------------------------------------------------------------
  // Step 2 — Scoreboard (optional source)
  // -------------------------------------------------------------------------

  const scoreboardEntries = await fetchScoreboard();

  if (!scoreboardEntries) {
    console.warn("[slate] scoreboardAdapter returned null");
    errors.push("scoreboardAdapter returned null — live scores unavailable");
    overallStatus = "partial";

    // Fallback: if we have cached scoreboard data, overlay it for known games
    if (cached) {
      for (const cachedGame of cached.response.games) {
        const base = gameMap.get(cachedGame.game_id);
        if (base) {
          gameMap.set(cachedGame.game_id, {
            ...overlayScoreboard(base, cachedGame.teams, cachedGame.status, cachedGame.network),
            stale: true,
            last_synced: cached.cachedAt,
          });
        }
      }
    }
  } else {
    sources.push("https://ncaa-api.henrygd.me/scoreboard/basketball-men/d1");

    for (const entry of scoreboardEntries) {
      const base = gameMap.get(entry.game.game_id);
      if (base) {
        const merged = overlayScoreboard(
          base,
          entry.game.teams,
          entry.game.status,
          entry.network
        );
        // Overlay scoreboard bracketRound when bracket didn't have it
        merged.bracketRound = entry.bracketRound ?? merged.bracketRound;
        merged.startTimeEpoch = entry.startTimeEpoch ?? merged.startTimeEpoch;
        gameMap.set(entry.game.game_id, merged);
      } else {
        // Game on scoreboard not in bracket — include as SlateGame with null bracket fields
        const slateGame: SlateGame = {
          ...entry.game,
          bracketRound: entry.bracketRound,
          sectionId: null,
          startDate: null,
          startTimeEpoch: entry.startTimeEpoch,
          network: entry.network,
          broadcaster: null,
        };
        gameMap.set(entry.game.game_id, slateGame);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3 — Boxscore fetch (final + live games only, throttled)
  // Unbounded Promise.all causes HTTP 428 rate-limit from the NCAA API.
  // Process in batches of 5 with a 200ms gap between batches.
  // -------------------------------------------------------------------------

  const gamesArray = Array.from(gameMap.values());

  async function fetchBoxscoreThrottled(
    games: SlateGame[],
    batchSize = 5,
    delayMs = 200
  ): Promise<SlateGame[]> {
    const results: SlateGame[] = [];
    for (let i = 0; i < games.length; i += batchSize) {
      const batch = games.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (game): Promise<SlateGame> => {
          if (game.status === "scheduled") return game;

          // Reuse cached stats if fresh
          if (!forceRefresh && cached) {
            const cachedGame = cached.response.games.find(
              (g) => g.game_id === game.game_id
            );
            if (
              cachedGame &&
              !cachedGame.stale &&
              Object.keys(cachedGame.team_stats_raw).length > 0
            ) {
              return {
                ...game,
                team_stats_raw: cachedGame.team_stats_raw,
                player_stats_raw: cachedGame.player_stats_raw,
                last_synced: cachedGame.last_synced,
              };
            }
          }

          const boxscore = await fetchBoxscore(game.game_id);
          sources.push(
            `https://ncaa-api.henrygd.me/game/${game.game_id}/boxscore`
          );

          if (!boxscore) {
            if (cached) {
              const cachedGame = cached.response.games.find(
                (g) => g.game_id === game.game_id
              );
              if (
                cachedGame &&
                Object.keys(cachedGame.team_stats_raw).length > 0
              ) {
                return {
                  ...game,
                  team_stats_raw: cachedGame.team_stats_raw,
                  player_stats_raw: cachedGame.player_stats_raw,
                  stale: true,
                  last_synced: cached.cachedAt,
                };
              }
            }
            return {
              ...game,
              team_stats_raw: {},
              player_stats_raw: {},
              stale: true,
              last_synced: game.last_synced,
            };
          }

          return {
            ...game,
            team_stats_raw: boxscore.team_stats_raw,
            player_stats_raw: boxscore.player_stats_raw,
            stale: false,
            last_synced: new Date().toISOString(),
          };
        })
      );
      results.push(...batchResults);
      if (i + batchSize < games.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return results;
  }

  const withStats = await fetchBoxscoreThrottled(gamesArray);

  // -------------------------------------------------------------------------
  // Step 4 — Finalize and cache
  // -------------------------------------------------------------------------

  // Deduplicate sources (boxscore URLs will repeat on repeated calls)
  const uniqueSources = [...new Set(sources)];

  // If any game is stale, escalate status and log which games
  const staleGames = withStats.filter((g) => g.stale);
  if (staleGames.length > 0) {
    if (overallStatus === "ok") overallStatus = "partial";
    errors.push(
      `${staleGames.length} game(s) missing boxscore data — serving stale or empty stats: ${staleGames.map((g) => g.game_id).join(", ")}`
    );
  }

  const syncedAt = new Date().toISOString();

  const slateResponse: SlateResponse = {
    status: overallStatus,
    syncedAt,
    sources: uniqueSources,
    errors,
    games: withStats,
  };

  // Only cache responses that have at least some game data
  if (withStats.length > 0) {
    slateCache.set(year, { response: slateResponse, cachedAt: syncedAt });
  }

  return Response.json(slateResponse);
}
