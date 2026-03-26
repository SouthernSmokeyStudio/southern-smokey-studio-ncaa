"use client";

// GameProjectionsTab.tsx
// Phase 5 — Game Projections UI.
// Fetches slate, runs projection engine client-side, displays results.
// No fake numbers. No placeholder projections. Blocked games show blocked_reason.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlateResponse } from "@/lib/types";
import type { GameProjection } from "@/lib/projections/types";
import { projectGame } from "@/lib/projections/projectMargin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMargin(margin: number): string {
  if (margin > 0) return `+${margin.toFixed(1)}`;
  return margin.toFixed(1);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtVal(key: string, val: number): string {
  // Rate features stored as decimals — display as percentages
  const rateKeys = new Set([
    "efg_pct_a", "efg_pct_b", "efg_pct_diff",
    "tov_rate_a", "tov_rate_b", "tov_rate_diff",
    "oreb_rate_a", "oreb_rate_b", "oreb_rate_diff",
    "ftr_a", "ftr_b", "ftr_diff",
    "three_pct_diff", "ft_pct_diff",
  ]);
  if (rateKeys.has(key)) return fmtPct(val);
  if (key === "pace_a" || key === "pace_b") return val.toFixed(1);
  return val.toFixed(2);
}

function fmtSync(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

function ConfidenceBadge({
  level,
}: {
  level: GameProjection["projection_confidence"];
}) {
  if (!level) return null;
  const styles: Record<NonNullable<GameProjection["projection_confidence"]>, string> = {
    high:   "text-green-400 bg-green-950 border-green-900",
    medium: "text-yellow-400 bg-yellow-950 border-yellow-900",
    low:    "text-zinc-400 bg-zinc-800 border-zinc-700",
  };
  return (
    <span
      className={`text-[10px] font-mono font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border ${styles[level]}`}
    >
      {level} conf
    </span>
  );
}

// ---------------------------------------------------------------------------
// Feature row (for the formula inputs table)
// ---------------------------------------------------------------------------

const FEATURE_LABELS: Record<string, string> = {
  efg_pct_diff:   "eFG% diff",
  tov_rate_diff:  "TOV rate diff",
  oreb_rate_diff: "OREB rate diff",
  ftr_diff:       "FT rate diff",
  three_pct_diff: "3PT% diff",
  ft_pct_diff:    "FT% diff",
  ast_diff:       "Assist diff",
  stl_diff:       "Steal diff",
  blk_diff:       "Block diff",
};

// ---------------------------------------------------------------------------
// Single projection card
// ---------------------------------------------------------------------------

function ProjectionCard({
  projection,
  teamAName,
  teamBName,
}: {
  projection: GameProjection;
  teamAName: string;
  teamBName: string;
}) {
  const [showFeatures, setShowFeatures] = useState(false);
  const isBlocked = projection.projection_status === "blocked";

  return (
    <div
      className={[
        "rounded border flex flex-col gap-3 px-4 py-4",
        isBlocked
          ? "border-zinc-800 bg-zinc-900/50"
          : "border-zinc-700 bg-zinc-900",
      ].join(" ")}
    >
      {/* Matchup header */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-sm font-mono font-semibold text-white">
          {teamAName}
          <span className="text-zinc-600 mx-2">vs</span>
          {teamBName}
        </span>
        <span className="text-[10px] font-mono text-zinc-600">
          {projection.game_id}
        </span>
      </div>

      {/* Blocked state */}
      {isBlocked && (
        <div className="flex items-start gap-2">
          <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 shrink-0 mt-0.5">
            BLOCKED
          </span>
          <span className="text-xs font-mono text-zinc-500">
            {projection.blocked_reason}
          </span>
        </div>
      )}

      {/* Projected state */}
      {!isBlocked && projection.projected_margin !== null && (
        <>
          {/* Margin + winner */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={[
                "text-2xl font-mono font-bold tabular-nums",
                projection.projected_margin > 0
                  ? "text-green-400"
                  : projection.projected_margin < 0
                  ? "text-red-400"
                  : "text-zinc-400",
              ].join(" ")}
            >
              {fmtMargin(projection.projected_margin)}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-mono text-zinc-400">
                {projection.projected_winner === "a"
                  ? `${teamAName} projected winner`
                  : projection.projected_winner === "b"
                  ? `${teamBName} projected winner`
                  : "Pick 'em"}
              </span>
              <div className="flex items-center gap-2">
                <ConfidenceBadge level={projection.projection_confidence} />
                <span className="text-[10px] font-mono text-zinc-600">
                  {projection.model_version}
                </span>
              </div>
            </div>
          </div>

          {/* Key feature differentials */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            {projection.features_used.map((key) => {
              const val = projection.feature_values[key];
              if (val === undefined) return null;
              const isPositive = val > 0.001;
              const isNegative = val < -0.001;
              return (
                <div key={key} className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono text-zinc-600 truncate">
                    {FEATURE_LABELS[key] ?? key}
                  </span>
                  <span
                    className={[
                      "text-[10px] font-mono tabular-nums font-semibold shrink-0",
                      isPositive ? "text-green-500" : isNegative ? "text-red-400" : "text-zinc-500",
                    ].join(" ")}
                  >
                    {fmtVal(key, val)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Expand: full feature table */}
          <button
            onClick={() => setShowFeatures((v) => !v)}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 text-left transition-colors"
          >
            {showFeatures ? "▲ hide feature detail" : "▼ show feature detail"}
          </button>

          {showFeatures && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-1 px-1 text-zinc-600 font-normal">Feature</th>
                    <th className="text-right py-1 px-1 text-zinc-600 font-normal">{teamAName}</th>
                    <th className="text-right py-1 px-1 text-zinc-600 font-normal">{teamBName}</th>
                    <th className="text-right py-1 px-1 text-zinc-600 font-normal">Diff (A)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["eFG%",       "efg_pct_a",    "efg_pct_b",    "efg_pct_diff"],
                    ["TOV rate",   "tov_rate_b",   "tov_rate_a",   "tov_rate_diff"],   // note: a/b swapped (inverted feature)
                    ["OREB rate",  "oreb_rate_a",  "oreb_rate_b",  "oreb_rate_diff"],
                    ["FT rate",    "ftr_a",        "ftr_b",        "ftr_diff"],
                    ["3PT%",       null,           null,           "three_pct_diff"],
                    ["FT%",        null,           null,           "ft_pct_diff"],
                    ["Assists",    null,           null,           "ast_diff"],
                    ["Steals",     null,           null,           "stl_diff"],
                    ["Blocks",     null,           null,           "blk_diff"],
                    ["Pace",       "pace_a",       "pace_b",       null],
                  ].map(([label, keyA, keyB, keyDiff]) => {
                    const valA = keyA ? projection.feature_values[keyA] : null;
                    const valB = keyB ? projection.feature_values[keyB] : null;
                    const valDiff = keyDiff ? projection.feature_values[keyDiff] : null;
                    return (
                      <tr key={String(label)} className="border-t border-zinc-800/50">
                        <td className="py-1 px-1 text-zinc-500">{label}</td>
                        <td className="py-1 px-1 text-right text-zinc-300 tabular-nums">
                          {valA !== null && valA !== undefined ? fmtVal(keyA!, valA) : "—"}
                        </td>
                        <td className="py-1 px-1 text-right text-zinc-300 tabular-nums">
                          {valB !== null && valB !== undefined ? fmtVal(keyB!, valB) : "—"}
                        </td>
                        <td className={[
                          "py-1 px-1 text-right tabular-nums font-semibold",
                          valDiff !== null && valDiff !== undefined
                            ? valDiff > 0.001 ? "text-green-500"
                              : valDiff < -0.001 ? "text-red-400"
                              : "text-zinc-500"
                            : "text-zinc-600",
                        ].join(" ")}>
                          {valDiff !== null && valDiff !== undefined
                            ? fmtVal(keyDiff!, valDiff)
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export default function GameProjectionsTab() {
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

  // Run projection engine on every game that has stats.
  // useMemo so we don't re-run the engine on every render.
  const projections = useMemo(() => {
    if (!slate) return [];
    return slate.games.map((game) => ({
      game,
      projection: projectGame(game),
    }));
  }, [slate]);

  const projectedCount = projections.filter(
    (p) => p.projection.projection_status === "projected"
  ).length;
  const blockedCount = projections.length - projectedCount;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h2 className="text-sm font-mono font-semibold uppercase tracking-widest text-white">
            Game Projections
          </h2>
          {slate && (
            <p className="text-[10px] font-mono text-zinc-500 mt-1">
              Slate synced: {fmtSync(slate.syncedAt)}
              {" · "}
              {projectedCount} projected · {blockedCount} blocked
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
        <p className="text-xs font-mono text-zinc-500">Fetching slate…</p>
      )}

      {/* Fetch error */}
      {!loading && fetchError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{fetchError}</p>
        </div>
      )}

      {/* Projections grid */}
      {!loading && projections.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {projections.map(({ game, projection }) => {
              const teamAName = game.teams[0]?.name ?? "Team A";
              const teamBName = game.teams[1]?.name ?? "Team B";
              return (
                <ProjectionCard
                  key={game.game_id}
                  projection={projection}
                  teamAName={teamAName}
                  teamBName={teamBName}
                />
              );
            })}
          </div>

          {/* Model disclaimer */}
          <p className="mt-8 text-[10px] font-mono text-zinc-700 border-t border-zinc-800 pt-4">
            Projections are v0.1 — deterministic feature model. Not yet backtested.
            Do not treat as validated. Coefficients are theory-grounded approximations,
            not fitted to historical data. Confidence levels are heuristic only.
          </p>
        </div>
      )}
    </div>
  );
}
