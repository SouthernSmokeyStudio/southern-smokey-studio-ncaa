"use client";

// ValidationPanel.tsx
// Backtesting results for the game projection engine.
//
// Runs runBacktest() against all completed games in the current slate.
// Displays: winner accuracy, MAE, by-confidence breakdown,
//           biggest misses, full results table, coefficient recommendations.
//
// MANIFESTO compliance: No quality claims are made without this panel.
// The leakage warning is always displayed — it cannot be collapsed or hidden.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlateResponse } from "@/lib/types";
import {
  runBacktest,
  deriveRecommendations,
  type BacktestSummary,
  type BacktestRecord,
} from "@/lib/backtest/runBacktest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null, decimals = 1): string {
  if (n === null) return "—";
  return n.toFixed(decimals);
}

function fmtMargin(m: number): string {
  return m > 0 ? `+${m.toFixed(1)}` : m.toFixed(1);
}

function fmtSync(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

function accuracyColor(acc: number | null): string {
  if (acc === null) return "text-zinc-500";
  if (acc >= 0.68) return "text-green-400";
  if (acc >= 0.55) return "text-yellow-400";
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 px-4 py-3 flex flex-col gap-1">
      <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span className={`text-2xl font-mono font-bold tabular-nums ${valueClass ?? "text-white"}`}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px] font-mono text-zinc-600">{sub}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By-confidence breakdown table
// ---------------------------------------------------------------------------

function ConfTable({ summary }: { summary: BacktestSummary }) {
  const tiers = [
    { key: "high"   as const, label: "High (|proj| ≥ 10 pts)" },
    { key: "medium" as const, label: "Medium (5–9.9 pts)"     },
    { key: "low"    as const, label: "Low (< 5 pts)"          },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-1.5 px-3 text-left font-normal text-zinc-600">Confidence tier</th>
            <th className="py-1.5 px-3 text-right font-normal text-zinc-600">Games</th>
            <th className="py-1.5 px-3 text-right font-normal text-zinc-600">Correct</th>
            <th className="py-1.5 px-3 text-right font-normal text-zinc-600">Accuracy</th>
            <th className="py-1.5 px-3 text-right font-normal text-zinc-600">MAE</th>
            <th className="py-1.5 px-3 text-right font-normal text-zinc-600">Bias</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map(({ key, label }) => {
            const split = summary.by_confidence[key];
            return (
              <tr key={key} className="border-t border-zinc-800/50">
                <td className="py-1.5 px-3 text-zinc-400">{label}</td>
                <td className="py-1.5 px-3 text-right text-zinc-400 tabular-nums">{split.count}</td>
                <td className="py-1.5 px-3 text-right text-zinc-400 tabular-nums">{split.correct}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums font-semibold ${accuracyColor(split.accuracy)}`}>
                  {fmtPct(split.accuracy)}
                </td>
                <td className="py-1.5 px-3 text-right text-zinc-400 tabular-nums">
                  {fmtNum(split.mae)} pts
                </td>
                <td className={`py-1.5 px-3 text-right tabular-nums ${
                  split.mean_signed_error === null ? "text-zinc-600"
                  : split.mean_signed_error > 1   ? "text-red-400"
                  : split.mean_signed_error < -1  ? "text-blue-400"
                  : "text-zinc-400"
                }`}>
                  {split.mean_signed_error !== null
                    ? `${split.mean_signed_error > 0 ? "+" : ""}${split.mean_signed_error.toFixed(1)} pts`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Biggest misses table
// ---------------------------------------------------------------------------

function MissesTable({ records }: { records: BacktestRecord[] }) {
  if (records.length === 0) {
    return <p className="text-xs font-mono text-zinc-600">No scored games available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-1.5 px-2 text-left font-normal text-zinc-600">Matchup</th>
            <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Proj</th>
            <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Actual</th>
            <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Error</th>
            <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Correct?</th>
            <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Conf</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.game_id} className="border-t border-zinc-800/40">
              <td className="py-1.5 px-2 text-zinc-400">
                {r.teamAName} vs {r.teamBName}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-400">
                {fmtMargin(r.projected_margin)}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-zinc-300">
                {r.actual_margin !== null ? fmtMargin(r.actual_margin) : "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-red-400 font-semibold">
                {r.margin_error !== null ? `${r.margin_error.toFixed(1)} pts` : "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">
                {r.is_correct === null ? (
                  <span className="text-zinc-600">—</span>
                ) : r.is_correct ? (
                  <span className="text-green-500">✓</span>
                ) : (
                  <span className="text-red-400">✗</span>
                )}
              </td>
              <td className="py-1.5 px-2 text-right text-zinc-600">
                {r.projection_confidence}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full results table (collapsible)
// ---------------------------------------------------------------------------

function FullResultsTable({ records }: { records: BacktestRecord[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        {open
          ? `▲ collapse all ${records.length} results`
          : `▼ show all ${records.length} results`}
      </button>

      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-1.5 px-2 text-left font-normal text-zinc-600">Matchup</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Proj winner</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Proj margin</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Actual margin</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Error</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Correct</th>
                <th className="py-1.5 px-2 text-right font-normal text-zinc-600">Conf</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.game_id}
                  className="border-t border-zinc-800/30 hover:bg-zinc-800/20"
                >
                  <td className="py-1 px-2 text-zinc-400 whitespace-nowrap">
                    {r.teamAName} vs {r.teamBName}
                  </td>
                  <td className="py-1 px-2 text-right text-zinc-500">
                    {r.projected_winner === "a"
                      ? r.teamAName
                      : r.projected_winner === "b"
                      ? r.teamBName
                      : "Pick 'em"}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums text-zinc-400">
                    {fmtMargin(r.projected_margin)}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums text-zinc-300">
                    {r.actual_margin !== null ? fmtMargin(r.actual_margin) : "—"}
                  </td>
                  <td className={`py-1 px-2 text-right tabular-nums ${
                    r.margin_error !== null && r.margin_error > 15
                      ? "text-red-400"
                      : r.margin_error !== null && r.margin_error > 8
                      ? "text-yellow-400"
                      : "text-zinc-500"
                  }`}>
                    {r.margin_error !== null ? r.margin_error.toFixed(1) : "—"}
                  </td>
                  <td className="py-1 px-2 text-right">
                    {r.is_correct === null ? (
                      <span className="text-zinc-700">—</span>
                    ) : r.is_correct ? (
                      <span className="text-green-500">✓</span>
                    ) : (
                      <span className="text-red-400">✗</span>
                    )}
                  </td>
                  <td className="py-1 px-2 text-right text-zinc-700">
                    {r.projection_confidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function ValidationPanel() {
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

  const summary = useMemo(
    () => (slate ? runBacktest(slate.games) : null),
    [slate]
  );

  const recs = useMemo(
    () => (summary ? deriveRecommendations(summary) : []),
    [summary]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h2 className="text-sm font-mono font-semibold uppercase tracking-widest text-white">
            Model Validation
          </h2>
          {summary && (
            <p className="text-[10px] font-mono text-zinc-500 mt-1">
              {summary.model_version} · run {fmtSync(summary.run_at)}
              {" · "}
              {summary.games_with_season_stats} eligible games ·{" "}
              {summary.games_projected} projected · {summary.games_blocked} blocked
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

      {loading && <p className="text-xs font-mono text-zinc-500">Fetching slate…</p>}

      {!loading && fetchError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{fetchError}</p>
        </div>
      )}

      {!loading && summary && (
        <div className="flex-1 overflow-auto flex flex-col gap-6">

          {/* ------------------------------------------------------------------ */}
          {/* Leakage warning — always visible, cannot be hidden                  */}
          {/* ------------------------------------------------------------------ */}
          <div className="rounded border border-yellow-800 bg-yellow-950/20 px-4 py-3">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-yellow-600 mb-1">
              Temporal Integrity Warning
            </p>
            <p className="text-[11px] font-mono text-yellow-700">
              {summary.leakage_warning}
            </p>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Top-line accuracy tiles                                             */}
          {/* ------------------------------------------------------------------ */}
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Overall Accuracy
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Winner Accuracy"
                value={fmtPct(summary.winner_accuracy)}
                sub={`${summary.winner_correct}/${summary.games_with_winner} games`}
                valueClass={accuracyColor(summary.winner_accuracy)}
              />
              <StatTile
                label="Margin MAE"
                value={
                  summary.mae !== null ? `${summary.mae.toFixed(1)} pts` : "—"
                }
                sub={`${summary.games_with_score} games with score`}
                valueClass={
                  summary.mae === null ? "text-zinc-500"
                  : summary.mae < 8 ? "text-green-400"
                  : summary.mae < 13 ? "text-yellow-400"
                  : "text-red-400"
                }
              />
              <StatTile
                label="Margin Bias"
                value={
                  summary.mean_signed_error !== null
                    ? `${summary.mean_signed_error > 0 ? "+" : ""}${summary.mean_signed_error.toFixed(1)} pts`
                    : "—"
                }
                sub={
                  summary.mean_signed_error === null ? ""
                  : summary.mean_signed_error > 0
                  ? "over-projecting margins"
                  : summary.mean_signed_error < 0
                  ? "under-projecting margins"
                  : "no systematic bias"
                }
                valueClass={
                  summary.mean_signed_error === null ? "text-zinc-500"
                  : Math.abs(summary.mean_signed_error) < 2 ? "text-zinc-300"
                  : "text-yellow-400"
                }
              />
              <StatTile
                label="Games Blocked"
                value={String(summary.games_blocked)}
                sub={`of ${summary.games_with_season_stats} eligible`}
                valueClass={
                  summary.games_blocked === 0 ? "text-green-400"
                  : summary.games_blocked < 5 ? "text-yellow-400"
                  : "text-red-400"
                }
              />
            </div>
          </section>

          {/* ------------------------------------------------------------------ */}
          {/* By confidence                                                       */}
          {/* ------------------------------------------------------------------ */}
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Accuracy by Confidence Tier
            </h3>
            <div className="rounded border border-zinc-800 bg-zinc-900 overflow-hidden">
              <ConfTable summary={summary} />
            </div>
            <p className="text-[10px] font-mono text-zinc-700 mt-2">
              Bias column: positive = projected team_a margin too high (over-projected). Negative = under-projected.
              High-confidence picks should consistently outperform low-confidence to validate the confidence heuristic.
            </p>
          </section>

          {/* ------------------------------------------------------------------ */}
          {/* Biggest misses                                                      */}
          {/* ------------------------------------------------------------------ */}
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Biggest Misses (Top 5 by Margin Error)
            </h3>
            <div className="rounded border border-zinc-800 bg-zinc-900 overflow-hidden">
              <MissesTable records={summary.biggest_misses} />
            </div>
          </section>

          {/* ------------------------------------------------------------------ */}
          {/* Coefficient recommendations                                         */}
          {/* ------------------------------------------------------------------ */}
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              Coefficient Recommendations
            </h3>
            {recs.length === 0 ? (
              <p className="text-xs font-mono text-zinc-600">
                Insufficient data to generate recommendations. Need ≥5 completed games with scores.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {recs.map((rec, i) => (
                  <div
                    key={i}
                    className={[
                      "rounded border px-4 py-3 flex flex-col gap-1",
                      rec.direction === "decrease"
                        ? "border-red-900 bg-red-950/20"
                        : rec.direction === "increase"
                        ? "border-blue-900 bg-blue-950/20"
                        : "border-zinc-800 bg-zinc-900/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "text-[10px] font-mono font-semibold uppercase tracking-widest",
                          rec.direction === "decrease" ? "text-red-400"
                          : rec.direction === "increase" ? "text-blue-400"
                          : "text-zinc-500",
                        ].join(" ")}
                      >
                        {rec.direction === "decrease" ? "↓ Reduce"
                          : rec.direction === "increase" ? "↑ Raise"
                          : "✓ Hold"}
                      </span>
                      <span className="text-xs font-mono font-semibold text-zinc-300">
                        {rec.feature}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-500">{rec.reasoning}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ------------------------------------------------------------------ */}
          {/* Full results                                                        */}
          {/* ------------------------------------------------------------------ */}
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3">
              All Results
            </h3>
            <div className="rounded border border-zinc-800 bg-zinc-900 px-4 py-3">
              <FullResultsTable records={summary.results} />
            </div>
          </section>

          {/* Footer */}
          <p className="text-[10px] font-mono text-zinc-700 border-t border-zinc-800 pt-4">
            Backtest uses the same projectGame() function as forward projections. No separate
            test-time pipeline exists. Results are not a clean holdout — see temporal leakage
            warning above. Accuracy figures should not be cited publicly until a true pre-tournament
            stat snapshot can be used as input.
          </p>
        </div>
      )}
    </div>
  );
}
