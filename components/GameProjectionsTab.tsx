"use client";

// GameProjectionsTab.tsx
// v0.3 — Redesigned as a game brief / scouting card.
//
// Primary view: verdict, editorial context, confidence qualifier, game shape,
// top 3 key drivers. Technical feature detail is collapsed behind an expand link.
//
// Display rules:
//   scheduled → full projection brief
//   live      → live score + pre-game projection brief
//   final     → compact actual result only

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SlateGame, SlateResponse } from "@/lib/types";
import type { GameProjection } from "@/lib/projections/types";
import { projectGame } from "@/lib/projections/projectMargin";

// ---------------------------------------------------------------------------
// Coefficients — mirrors projectMargin.ts, used for contribution ranking only.
// Update here whenever projectMargin.ts COEFFICIENTS change.
// ---------------------------------------------------------------------------

const COEFFICIENTS: Record<string, number> = {
  efg_pct_diff:    55.0,
  tov_rate_diff:   25.0,
  reb_margin_diff:  0.35,
  ftr_diff:         8.0,
  three_pct_diff:  18.0,
  ft_pct_diff:      5.0,
  ast_diff:         0.5,
  stl_diff:         1.2,
  blk_diff:         0.8,
};

// ---------------------------------------------------------------------------
// Plain English labels for editorial + key drivers
// ---------------------------------------------------------------------------

const FEATURE_PLAIN: Record<string, { short: string; explanation: string }> = {
  efg_pct_diff:    { short: "shooting efficiency",  explanation: "Makes more of their shots, with extra weight on threes" },
  tov_rate_diff:   { short: "ball security",        explanation: "Commits fewer turnovers per possession" },
  reb_margin_diff: { short: "rebounding edge",      explanation: "Outrebounds opponents by a larger margin per game" },
  ftr_diff:        { short: "free throw rate",      explanation: "Gets to the line more often and converts" },
  three_pct_diff:  { short: "three-point shooting", explanation: "More accurate from beyond the arc" },
  ft_pct_diff:     { short: "free throw accuracy",  explanation: "More reliable when shooting from the line" },
  ast_diff:        { short: "ball movement",        explanation: "Creates more assisted baskets per game" },
  stl_diff:        { short: "defensive pressure",   explanation: "Forces more turnovers per game" },
  blk_diff:        { short: "shot protection",      explanation: "Blocks more shots per game" },
};

const ROUND_LABELS: Record<number, string> = {
  1: "First Round",
  2: "Second Round",
  3: "Sweet 16",
  4: "Elite Eight",
  5: "Final Four",
  6: "Championship",
};

// ---------------------------------------------------------------------------
// Verdict / editorial helpers
// ---------------------------------------------------------------------------

function getVerdictText(
  margin: number,
  winner: GameProjection["projected_winner"],
  teamAName: string,
  teamBName: string
): string {
  if (winner === null || Math.abs(margin) < 0.5) return "Coin flip — virtually even";
  const winnerName = winner === "a" ? teamAName : teamBName;
  const abs = Math.abs(margin);
  if (abs >= 10) return `${winnerName} controls this game`;
  if (abs >= 5)  return `${winnerName} by ${abs.toFixed(0)}`;
  if (abs >= 2)  return `Slight edge to ${winnerName}`;
  return "Coin flip — virtually even";
}

function getTopContributors(
  projection: GameProjection,
  n: number
): { key: string; contribution: number; favorsA: boolean }[] {
  return projection.features_used
    .map((key) => {
      const val = projection.feature_values[key] ?? 0;
      return {
        key,
        contribution: Math.abs((COEFFICIENTS[key] ?? 1) * val),
        favorsA: val > 0,
      };
    })
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, n);
}

function getEditorialContext(
  projection: GameProjection,
  teamAName: string,
  teamBName: string
): string {
  if (projection.projected_winner === null || projection.projected_margin === null) {
    return "Both teams are evenly matched across all measured categories.";
  }
  const winnerSide = projection.projected_winner;
  const winnerName = winnerSide === "a" ? teamAName : teamBName;

  // Top 2 features by contribution that favor the projected winner
  const winnerFeatures = projection.features_used
    .map((key) => {
      const val = projection.feature_values[key] ?? 0;
      const favorsWinner =
        (winnerSide === "a" && val > 0) || (winnerSide === "b" && val < 0);
      return { key, contribution: Math.abs((COEFFICIENTS[key] ?? 1) * val), favorsWinner };
    })
    .filter((f) => f.favorsWinner)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);

  const abs = Math.abs(projection.projected_margin);
  const strengthWord = abs > 8 ? "clear" : abs > 4 ? "moderate" : "slim";

  if (winnerFeatures.length === 0) {
    return `${winnerName} holds a ${strengthWord} overall advantage by aggregate margin.`;
  }
  const feat1 = FEATURE_PLAIN[winnerFeatures[0].key]?.short ?? winnerFeatures[0].key;
  if (winnerFeatures.length === 1) {
    return `${winnerName}'s ${feat1} advantage creates a ${strengthWord} edge in this matchup.`;
  }
  const feat2 = FEATURE_PLAIN[winnerFeatures[1].key]?.short ?? winnerFeatures[1].key;
  return `${winnerName}'s ${feat1} and ${feat2} create a ${strengthWord} advantage in this matchup.`;
}

function getConfidenceText(
  confidence: GameProjection["projection_confidence"]
): string {
  if (!confidence) return "";
  const map: Record<NonNullable<GameProjection["projection_confidence"]>, string> = {
    high:   "Strong signal across multiple categories",
    medium: "Moderate signal — edges present but within flipping range",
    low:    "Weak signal — limited data separation",
  };
  return map[confidence];
}

function getGameShape(projection: GameProjection): string[] {
  const fv = projection.feature_values;
  const efgA = fv["efg_pct_a"] ?? 0;
  const efgB = fv["efg_pct_b"] ?? 0;
  const tovA = fv["tov_rate_a"] ?? 0;
  const tovB = fv["tov_rate_b"] ?? 0;
  const rebDiff = Math.abs(fv["reb_margin_diff"] ?? 0);

  const avgEfg = (efgA + efgB) / 2;
  const avgTov = (tovA + tovB) / 2;

  const lines: string[] = [];

  if (avgEfg > 0.54) {
    lines.push("High-scoring environment — both teams shoot efficiently");
  } else if (avgEfg < 0.48) {
    lines.push("Defensive, lower-scoring game expected");
  } else {
    lines.push("Average scoring environment");
  }

  if (avgTov > 0.17) {
    lines.push("Turnover-prone on both ends — live ball situations likely");
  } else if (rebDiff > 4) {
    lines.push("Significant rebounding mismatch — second-chance points in play");
  } else {
    lines.push("Half-court, possession-based game");
  }

  return lines;
}

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

function fmtGameTime(epoch: number | null): string {
  if (epoch === null) return "";
  // NCAA API epoch; convert from seconds if < 1e12
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtVal(key: string, val: number): string {
  const pctKeys = new Set([
    "efg_pct_a", "efg_pct_b", "efg_pct_diff",
    "tov_rate_a", "tov_rate_b", "tov_rate_diff",
    "ftr_a", "ftr_b", "ftr_diff",
    "three_pct_diff", "ft_pct_diff",
  ]);
  const oneDecKeys = new Set([
    "reb_margin_a", "reb_margin_b", "reb_margin_diff",
    "ast_diff", "stl_diff", "blk_diff",
  ]);
  if (pctKeys.has(key)) return fmtPct(val);
  if (oneDecKeys.has(key)) return val.toFixed(1);
  return val.toFixed(2);
}

// ---------------------------------------------------------------------------
// Expanded model detail table (collapsed by default)
// ---------------------------------------------------------------------------

function DetailTable({
  projection,
  teamAName,
  teamBName,
}: {
  projection: GameProjection;
  teamAName: string;
  teamBName: string;
}) {
  const fv = projection.feature_values;

  return (
    <div className="flex flex-col gap-3 mt-1">
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
            {(
              [
                ["eFG%",       "efg_pct_a",    "efg_pct_b",    "efg_pct_diff"   ],
                ["TOV rate",   "tov_rate_b",   "tov_rate_a",   "tov_rate_diff"  ],
                ["Reb margin", "reb_margin_a", "reb_margin_b", "reb_margin_diff"],
                ["FT rate",    "ftr_a",        "ftr_b",        "ftr_diff"       ],
                ["3PT%",       null,           null,           "three_pct_diff" ],
                ["FT%",        null,           null,           "ft_pct_diff"    ],
                ["Assists/G",  null,           null,           "ast_diff"       ],
                ["Steals/G",   null,           null,           "stl_diff"       ],
                ["Blocks/G",   null,           null,           "blk_diff"       ],
              ] as [string, string | null, string | null, string][]
            ).map(([label, keyA, keyB, keyDiff]) => {
              const valA    = keyA    ? fv[keyA]    : null;
              const valB    = keyB    ? fv[keyB]    : null;
              const valDiff = fv[keyDiff] ?? null;
              return (
                <tr key={label} className="border-t border-zinc-800/50">
                  <td className="py-1 px-1 text-zinc-500">{label}</td>
                  <td className="py-1 px-1 text-right text-zinc-300 tabular-nums">
                    {valA !== null && valA !== undefined && keyA
                      ? fmtVal(keyA, valA) : "—"}
                  </td>
                  <td className="py-1 px-1 text-right text-zinc-300 tabular-nums">
                    {valB !== null && valB !== undefined && keyB
                      ? fmtVal(keyB, valB) : "—"}
                  </td>
                  <td className={[
                    "py-1 px-1 text-right tabular-nums font-semibold",
                    valDiff !== null
                      ? valDiff > 0.001 ? "text-green-500"
                        : valDiff < -0.001 ? "text-red-400"
                        : "text-zinc-500"
                      : "text-zinc-600",
                  ].join(" ")}>
                    {valDiff !== null ? fmtVal(keyDiff, valDiff) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-700 flex-wrap">
        <span>{projection.model_version}</span>
        <span>·</span>
        <span>generated {new Date(projection.generated_at).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projection brief — shared body for scheduled and live cards
// ---------------------------------------------------------------------------

function ProjectionBrief({
  projection,
  teamAName,
  teamBName,
}: {
  projection: GameProjection;
  teamAName: string;
  teamBName: string;
}) {
  const [showDetail, setShowDetail] = useState(false);

  if (projection.projection_status === "blocked") {
    return (
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 shrink-0 mt-0.5">
          BLOCKED
        </span>
        <span className="text-xs font-mono text-zinc-500">
          {projection.blocked_reason}
        </span>
      </div>
    );
  }

  if (projection.projected_margin === null) return null;

  const margin       = projection.projected_margin;
  const verdict      = getVerdictText(margin, projection.projected_winner, teamAName, teamBName);
  const editorial    = getEditorialContext(projection, teamAName, teamBName);
  const confText     = getConfidenceText(projection.projection_confidence);
  const gameShape    = getGameShape(projection);
  const keyDrivers   = getTopContributors(projection, 3);

  return (
    <div className="flex flex-col gap-3">
      {/* PRIMARY VERDICT */}
      <p className="text-xl font-bold text-white leading-snug tracking-tight">
        {verdict}
      </p>

      {/* EDITORIAL CONTEXT */}
      <p className="text-sm text-zinc-400 leading-relaxed">
        {editorial}
      </p>

      {/* CONFIDENCE QUALIFIER */}
      {confText && (
        <p className="text-[11px] italic text-zinc-600">
          {confText}
        </p>
      )}

      {/* GAME SHAPE */}
      <div className="flex flex-col gap-0.5">
        {gameShape.map((line, i) => (
          <p key={i} className="text-[11px] text-zinc-500">{line}</p>
        ))}
      </div>

      {/* KEY DRIVERS — top 3 by contribution */}
      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800/60">
        {keyDrivers.map((driver) => {
          const plain = FEATURE_PLAIN[driver.key];
          if (!plain) return null;
          const edgeTeam = driver.favorsA ? teamAName : teamBName;
          const favorsWinner =
            (projection.projected_winner === "a" && driver.favorsA) ||
            (projection.projected_winner === "b" && !driver.favorsA);
          return (
            <div key={driver.key} className="flex flex-col gap-0.5">
              <span
                className={[
                  "text-xs font-semibold",
                  favorsWinner ? "text-green-400" : "text-red-400",
                ].join(" ")}
              >
                {plain.short.charAt(0).toUpperCase() + plain.short.slice(1)}: {edgeTeam}
              </span>
              <span className="text-[10px] text-zinc-600">
                {plain.explanation}
              </span>
            </div>
          );
        })}
      </div>

      {/* EXPAND — full model detail */}
      <button
        onClick={() => setShowDetail((v) => !v)}
        className="text-[10px] font-mono text-zinc-700 hover:text-zinc-500 text-left transition-colors"
      >
        {showDetail ? "▲ hide model detail" : "▼ full model detail"}
      </button>

      {showDetail && (
        <DetailTable
          projection={projection}
          teamAName={teamAName}
          teamBName={teamBName}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar — shared context strip for scheduled + live cards
// ---------------------------------------------------------------------------

function GameTopBar({
  game,
  statusLabel,
  statusColor,
  liveScore,
}: {
  game: SlateGame;
  statusLabel: string;
  statusColor: string;
  liveScore?: { scoreA: number | null | undefined; scoreB: number | null | undefined };
}) {
  const nameA = game.teams[0]?.name ?? "Team A";
  const nameB = game.teams[1]?.name ?? "Team B";
  const seedA = game.teams[0]?.seed;
  const seedB = game.teams[1]?.seed;

  const roundLabel = game.bracketRound !== null && game.bracketRound !== undefined
    ? (ROUND_LABELS[game.bracketRound] ?? `Round ${game.bracketRound}`)
    : null;
  const gameTime = game.startTimeEpoch != null ? fmtGameTime(game.startTimeEpoch) : null;

  return (
    <div className="flex flex-col gap-1">
      {/* Team names + status */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-white leading-snug">
          {seedA && <span className="text-zinc-500 text-[10px] font-normal mr-1">#{seedA}</span>}
          {nameA}
          <span className="text-zinc-600 mx-2">vs</span>
          {seedB && <span className="text-zinc-500 text-[10px] font-normal mr-1">#{seedB}</span>}
          {nameB}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {liveScore &&
            liveScore.scoreA != null &&
            liveScore.scoreB != null && (
              <span className="text-base font-bold tabular-nums text-yellow-300">
                {liveScore.scoreA}–{liveScore.scoreB}
              </span>
            )}
          <span className={`text-[10px] font-mono font-semibold uppercase tracking-widest ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Context: time · round · network · region */}
      {(gameTime || roundLabel || game.network || game.sectionId != null) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {gameTime && (
            <span className="text-[10px] font-mono text-zinc-600">{gameTime}</span>
          )}
          {roundLabel && (
            <>
              {gameTime && <span className="text-zinc-800">·</span>}
              <span className="text-[10px] font-mono text-zinc-600">{roundLabel}</span>
            </>
          )}
          {game.network && (
            <>
              <span className="text-zinc-800">·</span>
              <span className="text-[10px] font-mono text-zinc-700">{game.network}</span>
            </>
          )}
          {game.sectionId != null && (
            <>
              <span className="text-zinc-800">·</span>
              <span className="text-[10px] font-mono text-zinc-700">Region {game.sectionId}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled card
// ---------------------------------------------------------------------------

function ScheduledCard({
  game,
  projection,
}: {
  game: SlateGame;
  projection: GameProjection;
}) {
  const teamAName = game.teams[0]?.name ?? "Team A";
  const teamBName = game.teams[1]?.name ?? "Team B";
  const isBlocked = projection.projection_status === "blocked";

  return (
    <div
      className={[
        "rounded border flex flex-col gap-4 px-4 py-4",
        isBlocked ? "border-zinc-800 bg-zinc-900/50" : "border-zinc-700 bg-zinc-900",
      ].join(" ")}
    >
      <GameTopBar game={game} statusLabel="Scheduled" statusColor="text-blue-500" />
      <ProjectionBrief
        projection={projection}
        teamAName={teamAName}
        teamBName={teamBName}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live card
// ---------------------------------------------------------------------------

function LiveCard({
  game,
  projection,
}: {
  game: SlateGame;
  projection: GameProjection;
}) {
  const teamAName = game.teams[0]?.name ?? "Team A";
  const teamBName = game.teams[1]?.name ?? "Team B";
  const scoreA    = game.teams[0]?.score;
  const scoreB    = game.teams[1]?.score;

  return (
    <div className="rounded border border-yellow-900 bg-zinc-900 flex flex-col gap-4 px-4 py-4">
      <GameTopBar
        game={game}
        statusLabel="LIVE"
        statusColor="text-yellow-400 animate-pulse"
        liveScore={{ scoreA, scoreB }}
      />
      <div className="border-t border-zinc-800 pt-3">
        <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-3">
          Pre-game projection
        </p>
        <ProjectionBrief
          projection={projection}
          teamAName={teamAName}
          teamBName={teamBName}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final card — compact actual result
// ---------------------------------------------------------------------------

function FinalCard({ game }: { game: SlateGame }) {
  const teamA   = game.teams[0];
  const teamB   = game.teams[1];
  const nameA   = teamA?.name ?? "Team A";
  const nameB   = teamB?.name ?? "Team B";
  const seedA   = teamA?.seed;
  const seedB   = teamB?.seed;
  const scoreA  = teamA?.score;
  const scoreB  = teamB?.score;
  const winnerA = teamA?.winner ?? false;
  const winnerB = teamB?.winner ?? false;
  const winnerName = winnerA ? nameA : winnerB ? nameB : null;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-zinc-400">
          {seedA && <span className="text-zinc-600 text-[10px] font-normal mr-1">#{seedA}</span>}
          {nameA}
          <span className="text-zinc-700 mx-1.5">vs</span>
          {seedB && <span className="text-zinc-600 text-[10px] font-normal mr-1">#{seedB}</span>}
          {nameB}
        </span>
        <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-600">
          Final
        </span>
      </div>
      {scoreA != null && scoreB != null ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums text-zinc-200">
            {scoreA}–{scoreB}
          </span>
          {winnerName && (
            <span className="text-[10px] font-mono text-zinc-500">{winnerName} won</span>
          )}
        </div>
      ) : (
        <span className="text-[10px] font-mono text-zinc-600">Score unavailable</span>
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

  const { scheduled, live, final: finalGames } = useMemo(() => {
    if (!slate) return { scheduled: [], live: [], final: [] };
    const scheduled: Array<{ game: SlateGame; projection: GameProjection }> = [];
    const live:      Array<{ game: SlateGame; projection: GameProjection }> = [];
    const final:     SlateGame[] = [];
    for (const game of slate.games) {
      if (game.status === "final") {
        final.push(game);
      } else if (game.status === "live") {
        live.push({ game, projection: projectGame(game) });
      } else {
        scheduled.push({ game, projection: projectGame(game) });
      }
    }
    return { scheduled, live, final };
  }, [slate]);

  const allActiveProjections = [...scheduled, ...live].map((p) => p.projection);
  const projectedCount = allActiveProjections.filter((p) => p.projection_status === "projected").length;
  const blockedCount   = allActiveProjections.filter((p) => p.projection_status === "blocked").length;

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
              {scheduled.length} scheduled · {live.length} live · {finalGames.length} final
              {(projectedCount + blockedCount) > 0 && (
                <> · {projectedCount} projected · {blockedCount} blocked</>
              )}
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

      {loading && (
        <p className="text-xs font-mono text-zinc-500">Fetching slate and season stats…</p>
      )}

      {!loading && fetchError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3">
          <p className="text-xs font-mono text-red-400">{fetchError}</p>
        </div>
      )}

      {!loading && slate && (
        <div className="flex-1 overflow-auto">
          {/* Live */}
          {live.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-yellow-500 mb-3">
                Live · {live.length} game{live.length !== 1 ? "s" : ""}
              </h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {live.map(({ game, projection }) => (
                  <LiveCard key={game.game_id} game={game} projection={projection} />
                ))}
              </div>
            </section>
          )}

          {/* Upcoming */}
          {scheduled.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-blue-400 mb-3">
                Upcoming · {scheduled.length} game{scheduled.length !== 1 ? "s" : ""}
              </h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {scheduled.map(({ game, projection }) => (
                  <ScheduledCard key={game.game_id} game={game} projection={projection} />
                ))}
              </div>
            </section>
          )}

          {/* Completed */}
          {finalGames.length > 0 && (
            <section className="mb-6">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-600 mb-3">
                Completed · {finalGames.length} game{finalGames.length !== 1 ? "s" : ""}
              </h3>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {finalGames.map((game) => (
                  <FinalCard key={game.game_id} game={game} />
                ))}
              </div>
            </section>
          )}

          {live.length === 0 && scheduled.length === 0 && finalGames.length === 0 && (
            <p className="text-xs font-mono text-zinc-600">No games found in slate.</p>
          )}

          <p className="mt-4 text-[10px] font-mono text-zinc-700 border-t border-zinc-800 pt-4">
            Projections are v0.2-season — deterministic linear model using season averages.
            Not backtested. Coefficients are theory-grounded approximations, not fitted to data.
            Rebound margin is a proxy for OREB rate (OREB unavailable in NCAA stats API).
            Confidence levels are heuristic only. Do not treat as validated.
          </p>
        </div>
      )}
    </div>
  );
}
