"use client";

// PlayerProjectionsTab.tsx
// v0.1 — Player projections downstream of game projections.
//
// Data flow:
//   1. Fetch /api/sss/slate?year=2026
//   2. For each SCHEDULED game: run projectGame → GameProjection
//   3. Use allGames (full slate) to find player baselines from prior rounds
//   4. Run projectGamePlayers → per-team PlayerProjection[]
//
// Block conditions:
//   - GameProjection blocked → team blocked (no season stats)
//   - No completed game with player stats for this team → team blocked
//   - Player < 5 minutes in baseline → excluded
//
// Disclaimer: v0.1, single-game baseline, high variance, not backtested.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlateGame, SlateResponse } from "@/lib/types";
import type { GameProjection, TeamPlayerProjections } from "@/lib/projections/types";
import { projectGame } from "@/lib/projections/projectMargin";
import { projectGamePlayers } from "@/lib/projections/projectPlayers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt1(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(1);
}

function fmtDk(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(2);
}

function fmtMargin(margin: number): string {
  if (margin > 0) return `+${margin.toFixed(1)}`;
  return margin.toFixed(1);
}

function fmtSync(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// Sort column type
// ---------------------------------------------------------------------------

type SortKey = "dk" | "pts" | "reb" | "ast" | "min";

// ---------------------------------------------------------------------------
// Team player table
// ---------------------------------------------------------------------------

function TeamTable({
  proj,
}: {
  proj: TeamPlayerProjections;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("dk");

  if (proj.projection_status === "blocked") {
    return (
      <div className="flex items-start gap-2 py-2 px-3 rounded border border-zinc-800 bg-zinc-900/40">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 shrink-0 mt-0.5">
          BLOCKED
        </span>
        <span className="text-xs font-mono text-zinc-500">{proj.blocked_reason}</span>
      </div>
    );
  }

  const sorted = [...proj.players].sort((a, b) => {
    switch (sortKey) {
      case "pts": return (b.projected_points    ?? 0) - (a.projected_points    ?? 0);
      case "reb": return (b.projected_rebounds  ?? 0) - (a.projected_rebounds  ?? 0);
      case "ast": return (b.projected_assists   ?? 0) - (a.projected_assists   ?? 0);
      case "min": return (b.projected_minutes   ?? 0) - (a.projected_minutes   ?? 0);
      default:    return (b.projected_dk_points ?? 0) - (a.projected_dk_points ?? 0);
    }
  });

  function SortTh({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        onClick={() => setSortKey(col)}
        className={[
          "py-1 px-2 text-right cursor-pointer select-none font-normal transition-colors",
          sortKey === col ? "text-zinc-200" : "text-zinc-600 hover:text-zinc-400",
        ].join(" ")}
      >
        {label}
        {sortKey === col ? " ▼" : ""}
      </th>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-400 mb-2">
        {proj.team_name}
        <span className="text-zinc-700 ml-2 normal-case">
          ({proj.players.length} players projected)
        </span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-1 px-2 text-left font-normal text-zinc-600">Player</th>
              <th className="py-1 px-2 text-left font-normal text-zinc-600">Pos</th>
              <SortTh col="min" label="Min" />
              <SortTh col="pts" label="Pts" />
              <SortTh col="reb" label="Reb" />
              <SortTh col="ast" label="Ast" />
              <th className="py-1 px-2 text-right font-normal text-zinc-600">Stl</th>
              <th className="py-1 px-2 text-right font-normal text-zinc-600">Blk</th>
              <th className="py-1 px-2 text-right font-normal text-zinc-600">TO</th>
              <SortTh col="dk" label="DK" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.player_id}
                className="border-t border-zinc-800/40 hover:bg-zinc-800/20 transition-colors"
              >
                <td className="py-1 px-2 text-zinc-300 whitespace-nowrap">{p.player_name}</td>
                <td className="py-1 px-2 text-zinc-600">{p.position || "—"}</td>
                <td className="py-1 px-2 text-right text-zinc-500 tabular-nums">{fmt1(p.projected_minutes)}</td>
                <td className="py-1 px-2 text-right text-zinc-300 tabular-nums font-semibold">{fmt1(p.projected_points)}</td>
                <td className="py-1 px-2 text-right text-zinc-300 tabular-nums">{fmt1(p.projected_rebounds)}</td>
                <td className="py-1 px-2 text-right text-zinc-300 tabular-nums">{fmt1(p.projected_assists)}</td>
                <td className="py-1 px-2 text-right text-zinc-400 tabular-nums">{fmt1(p.projected_steals)}</td>
                <td className="py-1 px-2 text-right text-zinc-400 tabular-nums">{fmt1(p.projected_blocks)}</td>
                <td className="py-1 px-2 text-right text-red-400/80 tabular-nums">{fmt1(p.projected_turnovers)}</td>
                <td className="py-1 px-2 text-right tabular-nums font-bold text-yellow-400">
                  {fmtDk(p.projected_dk_points)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single game card
// ---------------------------------------------------------------------------

function GamePlayerCard({
  game,
  gameProjection,
  teamA,
  teamB,
}: {
  game: SlateGame;
  gameProjection: GameProjection;
  teamA: TeamPlayerProjections;
  teamB: TeamPlayerProjections;
}) {
  const nameA = game.teams[0]?.name ?? "Team A";
  const nameB = game.teams[1]?.name ?? "Team B";
  const isGameBlocked = gameProjection.projection_status === "blocked";

  return (
    <div className="rounded border border-zinc-700 bg-zinc-900 px-4 py-4 flex flex-col gap-4">
      {/* Game header */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-mono font-semibold text-white">
          {nameA}
          <span className="text-zinc-600 mx-2">vs</span>
          {nameB}
        </span>
        <div className="flex items-center gap-3">
          {!isGameBlocked && gameProjection.projected_margin !== null && (
            <span
              className={[
                "text-xs font-mono tabular-nums font-semibold",
                gameProjection.projected_margin > 0 ? "text-green-400" : "text-red-400",
              ].join(" ")}
            >
              {fmtMargin(gameProjection.projected_margin)} proj
            </span>
          )}
          {isGameBlocked && (
            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
              GAME BLOCKED
            </span>
          )}
          <span className="text-[10px] font-mono text-zinc-700">{game.game_id}</span>
        </div>
      </div>

      {isGameBlocked ? (
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 shrink-0 mt-0.5">
            BLOCKED
          </span>
          <span className="text-xs font-mono text-zinc-500">
            {gameProjection.blocked_reason}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <TeamTable proj={teamA} />
          <TeamTable proj={teamB} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export default function PlayerProjectionsTab() {
  const [slate, setSlate] = useState<SlateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/sss/slate?year=2026");
      if (!res.ok) {
        setFetchError(`HTTP ${res.status} — ${res.statusText}`);
        return;
      }
      setSlate(await res.json());
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // For each scheduled game: run game projection, then player projections.
  // allGames is passed to the player engine to find prior-round baselines.
  const gameCards = useMemo(() => {
    if (!slate) return [];

    const allGames: SlateGame[] = slate.games;
    const scheduled = allGames.filter((g) => g.status === "scheduled");

    return scheduled.map((game) => {
      const gameProjection = projectGame(game);
      const { teamA, teamB } = projectGamePlayers(game, gameProjection, allGames);
      return { game, gameProjection, teamA, teamB };
    });
  }, [slate]);

  const projectedGames = gameCards.filter(
    (c) => c.gameProjection.projection_status === "projected"
  ).length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h2 className="text-sm font-mono font-semibold uppercase tracking-widest text-white">
            Player Projections
          </h2>
          {slate && (
            <p className="text-[10px] font-mono text-zinc-500 mt-1">
              Slate synced: {fmtSync(slate.syncedAt)}
              {" · "}
              {gameCards.length} scheduled game{gameCards.length !== 1 ? "s" : ""}
              {" · "}
              {projectedGames} with game projection
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] font-mono font-semibold uppercase tracking-widest px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Fetching…" : "Refresh"}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-xs font-mono text-zinc-500">Fetching slate and season stats…</p>
      )}

      {/* Fetch error */}
      {!loading && fetchError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{fetchError}</p>
        </div>
      )}

      {/* Game cards */}
      {!loading && slate && (
        <div className="flex-1 overflow-auto">
          {gameCards.length === 0 ? (
            <div className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-4 py-4">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
                BLOCKED
              </span>
              <p className="text-xs font-mono text-zinc-500">
                No scheduled games found in slate. Player projections require at least one upcoming
                game. Check that the bracket has future rounds remaining.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {gameCards.map(({ game, gameProjection, teamA, teamB }) => (
                <GamePlayerCard
                  key={game.game_id}
                  game={game}
                  gameProjection={gameProjection}
                  teamA={teamA}
                  teamB={teamB}
                />
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <p className="mt-8 text-[10px] font-mono text-zinc-700 border-t border-zinc-800 pt-4">
            Player projections are v0.1 — single-game baseline from most recent tournament game.
            High variance. Not backtested. Minutes scaler applied to projected winners in blowouts.
            Do not treat as validated. DK scoring includes double/triple-double bonuses on projected stats.
          </p>
        </div>
      )}
    </div>
  );
}
