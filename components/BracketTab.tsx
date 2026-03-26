"use client";

import { useCallback, useEffect, useState } from "react";
import type { SlateGame, SlateResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Round and region label maps
// bracketRound confirmed from scoreboard: Sweet 16 = round 4.
// Remaining round numbers are inferred from tournament bracket structure.
// ---------------------------------------------------------------------------

const ROUND_LABELS: Record<number, string> = {
  1: "First Four",
  2: "First Four",
  3: "First Round",
  4: "Sweet 16",
  5: "Elite Eight",
  6: "Final Four",
  7: "Championship",
};

// sectionId → region label: mapping not confirmed from API.
// Displayed as "Region {n}" until confirmed.
function regionLabel(sectionId: number | null): string {
  if (sectionId === null) return "Unknown Region";
  return `Region ${sectionId}`;
}

function roundLabel(round: number | null): string {
  if (round === null) return "Unknown Round";
  return ROUND_LABELS[round] ?? `Round ${round}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEpoch(epoch: number | null): string {
  if (!epoch) return "";
  return new Date(epoch * 1000).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: SlateGame["status"] }) {
  const styles: Record<SlateGame["status"], string> = {
    scheduled: "text-zinc-500 bg-zinc-800",
    live: "text-green-400 bg-green-950 animate-pulse",
    final: "text-zinc-300 bg-zinc-800",
  };
  return (
    <span
      className={`text-[10px] font-mono font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function GameCard({ game }: { game: SlateGame }) {
  const [away, home] = game.teams.length >= 2
    ? [game.teams[0], game.teams[1]]
    : [game.teams[0], undefined];

  return (
    <div
      className={[
        "rounded border px-4 py-3 flex flex-col gap-2",
        game.stale
          ? "border-yellow-800 bg-yellow-950/30"
          : "border-zinc-800 bg-zinc-900",
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={game.status} />
        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          {game.network && <span>{game.network}</span>}
          {game.broadcaster && !game.network && (
            <span>{game.broadcaster}</span>
          )}
          {game.startTimeEpoch && (
            <span>{formatEpoch(game.startTimeEpoch)}</span>
          )}
        </div>
      </div>

      {/* Teams */}
      <div className="flex flex-col gap-1">
        {[away, home].map((team, i) => {
          if (!team) return null;
          const isWinner = team.winner;
          return (
            <div
              key={i}
              className={[
                "flex items-center justify-between gap-4",
                isWinner ? "text-white" : "text-zinc-400",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                {team.seed !== null && (
                  <span className="text-[10px] font-mono text-zinc-600 w-4 text-right shrink-0">
                    {team.seed}
                  </span>
                )}
                <span
                  className={`text-sm font-semibold ${isWinner ? "text-white" : ""}`}
                >
                  {team.name}
                </span>
              </div>
              <span className="text-sm font-mono font-semibold tabular-nums">
                {team.score !== null ? team.score : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Stale label */}
      {game.stale && (
        <div className="text-[10px] font-mono text-yellow-600">
          STALE — last synced:{" "}
          {game.last_synced ? formatSyncedAt(game.last_synced) : "unknown"}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round group
// ---------------------------------------------------------------------------

function RoundGroup({
  round,
  games,
}: {
  round: number | null;
  games: SlateGame[];
}) {
  // Group by sectionId within the round
  const bySection = new Map<number | null, SlateGame[]>();
  for (const g of games) {
    const key = g.sectionId;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(g);
  }

  return (
    <div className="mb-8">
      <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-zinc-400 mb-4 border-b border-zinc-800 pb-2">
        {roundLabel(round)}
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from(bySection.entries())
          .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
          .map(([sectionId, sectionGames]) => (
            <div key={String(sectionId)}>
              {bySection.size > 1 && (
                <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-2">
                  {regionLabel(sectionId)}
                </p>
              )}
              <div className="flex flex-col gap-3">
                {sectionGames.map((g) => (
                  <GameCard key={g.game_id} game={g} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BracketTab
// ---------------------------------------------------------------------------

export default function BracketTab() {
  const [slate, setSlate] = useState<SlateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setFetchError(null);
    try {
      const url = `/api/sss/slate?year=2026${refresh ? "&refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        setFetchError(`HTTP ${res.status} — ${res.statusText}`);
        return;
      }
      const data: SlateResponse = await res.json();
      setSlate(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  // -------------------------------------------------------------------------
  // Organize games by bracketRound
  // -------------------------------------------------------------------------

  const byRound = new Map<number | null, SlateGame[]>();
  if (slate) {
    for (const g of slate.games) {
      const key = g.bracketRound;
      if (!byRound.has(key)) byRound.set(key, []);
      byRound.get(key)!.push(g);
    }
  }

  const sortedRounds = Array.from(byRound.keys()).sort(
    (a, b) => (a ?? 99) - (b ?? 99)
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-sm font-mono font-semibold uppercase tracking-widest text-white">
            Southern Smokey Studio{" "}
            <span className="text-zinc-500">|</span> NCAA CBB
          </h1>
          {slate && (
            <p className="text-[10px] font-mono text-zinc-500 mt-1">
              Synced: {formatSyncedAt(slate.syncedAt)}
              {slate.status !== "ok" && (
                <span
                  className={`ml-2 uppercase font-semibold ${
                    slate.status === "error"
                      ? "text-red-500"
                      : "text-yellow-500"
                  }`}
                >
                  [{slate.status}]
                </span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => load(true)}
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

      {/* Client-side fetch error */}
      {!loading && fetchError && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3">
          <p className="text-xs font-mono font-semibold text-red-400 uppercase tracking-widest mb-1">
            Error
          </p>
          <p className="text-sm font-mono text-red-300">{fetchError}</p>
        </div>
      )}

      {/* Slate-level error from API */}
      {!loading && slate && slate.status === "error" && (
        <div className="rounded border border-red-800 bg-red-950/30 px-4 py-3 mb-6">
          <p className="text-xs font-mono font-semibold text-red-400 uppercase tracking-widest mb-1">
            Slate Error
          </p>
          {slate.errors.map((e, i) => (
            <p key={i} className="text-sm font-mono text-red-300">
              {e}
            </p>
          ))}
          {slate.games.length === 0 && (
            <p className="text-sm font-mono text-zinc-500 mt-2">
              No game data available.
            </p>
          )}
        </div>
      )}

      {/* Partial warning */}
      {!loading && slate && slate.status === "partial" && slate.errors.length > 0 && (
        <div className="rounded border border-yellow-800 bg-yellow-950/20 px-4 py-3 mb-6">
          <p className="text-xs font-mono font-semibold text-yellow-500 uppercase tracking-widest mb-1">
            Partial Data
          </p>
          {slate.errors.map((e, i) => (
            <p key={i} className="text-sm font-mono text-yellow-400">
              {e}
            </p>
          ))}
        </div>
      )}

      {/* Bracket rounds */}
      {!loading && slate && slate.games.length > 0 && (
        <div className="flex-1">
          {sortedRounds.map((round) => (
            <RoundGroup
              key={String(round)}
              round={round}
              games={byRound.get(round)!}
            />
          ))}
        </div>
      )}
    </div>
  );
}
