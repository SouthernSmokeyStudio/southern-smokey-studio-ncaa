"use client";

// BettingTab.tsx
// Downstream of Game Projections and Player Projections.
//
// Shows our projected spread (derived from game projection margin).
// Does NOT show projected totals — PPG is not in the current SeasonTeamStats
// schema and cannot be derived without fabrication.
//
// Market lines (DraftKings): NOT integrated. No market data source has been
// confirmed. Showing our lines alongside a placeholder column is honest
// and makes the gap explicit.
//
// Best bets: BLOCKED until market lines are available for comparison.
// Edge cannot be calculated without a market reference line.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlateGame, SlateResponse } from "@/lib/types";
import type { GameProjection } from "@/lib/projections/types";
import { projectGame } from "@/lib/projections/projectMargin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSync(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtSpread(
  margin: number,
  teamAName: string,
  teamBName: string
): string {
  // margin is team_a perspective — positive means team_a favored
  if (margin > 0)
    return `${teamAName} -${margin.toFixed(1)}`;
  if (margin < 0)
    return `${teamBName} -${Math.abs(margin).toFixed(1)}`;
  return "Pick 'em";
}

// ---------------------------------------------------------------------------
// Single game betting card
// ---------------------------------------------------------------------------

function GameBettingCard({
  game,
  projection,
}: {
  game: SlateGame;
  projection: GameProjection;
}) {
  const nameA = game.teams[0]?.name ?? "Team A";
  const nameB = game.teams[1]?.name ?? "Team B";
  const isBlocked = projection.projection_status === "blocked";

  return (
    <div
      className={[
        "rounded border flex flex-col gap-3 px-4 py-4",
        isBlocked
          ? "border-zinc-800 bg-zinc-900/40"
          : "border-zinc-700 bg-zinc-900",
      ].join(" ")}
    >
      {/* Matchup */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-mono font-semibold text-white">
          {nameA}
          <span className="text-zinc-600 mx-2">vs</span>
          {nameB}
        </span>
        <span className="text-[10px] font-mono text-zinc-700">{game.game_id}</span>
      </div>

      {isBlocked ? (
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 shrink-0 mt-0.5">
            BLOCKED
          </span>
          <span className="text-xs font-mono text-zinc-500">
            {projection.blocked_reason}
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {/* Our projected line */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
              Our Spread
            </span>
            <span className="text-sm font-mono font-bold text-white tabular-nums">
              {fmtSpread(projection.projected_margin ?? 0, nameA, nameB)}
            </span>
            <span className="text-[10px] font-mono text-zinc-600">
              {projection.model_version} · {projection.projection_confidence} conf
            </span>
          </div>

          {/* Our projected total */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
              Our Total
            </span>
            <span className="text-sm font-mono text-zinc-600">—</span>
            <span className="text-[10px] font-mono text-zinc-700">
              PPG not in season stats schema
            </span>
          </div>

          {/* Market lines placeholder */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
              Market (DK)
            </span>
            <span className="text-sm font-mono text-zinc-600">—</span>
            <span className="text-[10px] font-mono text-zinc-700">
              Not integrated
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export default function BettingTab() {
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

  const scheduledProjections = useMemo(() => {
    if (!slate) return [];
    return slate.games
      .filter((g) => g.status === "scheduled")
      .map((game): { game: SlateGame; projection: GameProjection } => ({
        game,
        projection: projectGame(game),
      }));
  }, [slate]);

  const projectedCount = scheduledProjections.filter(
    (p) => p.projection.projection_status === "projected"
  ).length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h2 className="text-sm font-mono font-semibold uppercase tracking-widest text-white">
            Betting Lines
          </h2>
          {slate && (
            <p className="text-[10px] font-mono text-zinc-500 mt-1">
              Slate synced: {fmtSync(slate.syncedAt)}
              {" · "}
              {scheduledProjections.length} upcoming · {projectedCount} with projected spread
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

      {!loading && slate && (
        <div className="flex-1 overflow-auto flex flex-col gap-6">

          {/* Projected spread cards */}
          {scheduledProjections.length > 0 ? (
            <section>
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                Projected Spreads — Upcoming Games
              </h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {scheduledProjections.map(({ game, projection }) => (
                  <GameBettingCard
                    key={game.game_id}
                    game={game}
                    projection={projection}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-4">
              <p className="text-xs font-mono text-zinc-500">
                No scheduled games found. Betting lines require upcoming games in the slate.
              </p>
            </div>
          )}

          {/* Best bets — explicitly blocked */}
          <section className="rounded border border-zinc-800 bg-zinc-900/40 px-4 py-4">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Top 5 Best Bets
            </h3>
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-600 shrink-0 mt-0.5">
                BLOCKED
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-xs font-mono text-zinc-500">
                  Cannot generate best bets until market lines are integrated for comparison.
                </p>
                <p className="text-[10px] font-mono text-zinc-600">
                  Edge = our projected spread minus market spread. Market spread source required.
                  DraftKings or another confirmed odds API must be integrated before any
                  edge claims can be made. No edge will be fabricated.
                </p>
              </div>
            </div>
          </section>

          {/* Market data gap notice */}
          <section className="rounded border border-zinc-800 bg-zinc-900/20 px-4 py-4">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-600 mb-2">
              Market Data Integration Status
            </h3>
            <div className="flex flex-col gap-1 text-[10px] font-mono text-zinc-600">
              <p>DK lines: <span className="text-zinc-500">Not yet integrated — market data source required</span></p>
              <p>Projected total: <span className="text-zinc-500">Blocked — PPG not in current season stats schema (endpoint 145 not yet included)</span></p>
              <p>CLV tracking: <span className="text-zinc-500">Blocked — requires closing line source</span></p>
              <p>Historical edge: <span className="text-zinc-500">Blocked — model not yet backtested</span></p>
            </div>
          </section>

          {/* Footer disclaimer */}
          <p className="text-[10px] font-mono text-zinc-700 border-t border-zinc-800 pt-4">
            Projected spreads are derived from game projection margins (v0.2-season).
            These are not betting advice. No market comparison exists yet.
            Do not wager based on projected spreads alone.
          </p>
        </div>
      )}
    </div>
  );
}
