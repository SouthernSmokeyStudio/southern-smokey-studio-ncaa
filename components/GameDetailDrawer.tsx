"use client";

// GameDetailDrawer.tsx
// Right-side slide-in drawer for a single SlateGame.
// Typed as SlateGame (extends CanonicalGame) — bracket/scoreboard display fields
// are all nullable, so this component works for any game type. Conditional
// rendering handles every absent field; nothing is fabricated.

import { useEffect } from "react";
import type { RawPlayerStats, RawTeamStats, SlateGame } from "@/lib/types";

// ---------------------------------------------------------------------------
// Round / region labels — duplicated from BracketTab so the drawer is
// self-contained and reusable without shared state.
// bracketRound 4 = Sweet 16 confirmed from live scoreboard. Others inferred.
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

function roundLabel(round: number | null): string | null {
  if (round === null) return null;
  return ROUND_LABELS[round] ?? `Round ${round}`;
}

function regionLabel(sectionId: number | null): string | null {
  if (sectionId === null) return null;
  return `Region ${sectionId}`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtEpoch(epoch: number | null): string | null {
  if (!epoch) return null;
  return new Date(epoch * 1000).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function fmtSync(iso: string | null): string {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtFraction(made: number, att: number): string {
  return `${made}/${att}`;
}

// ---------------------------------------------------------------------------
// Team-stat to team-name matching
// team_stats_raw and player_stats_raw are now keyed by seoname (e.g. "dayton"),
// re-keyed inside boxscoreAdapter using the top-level teams[] array that the
// /boxscore endpoint returns. CanonicalTeam.id is also seoname in both
// bracketAdapter and scoreboardAdapter — direct key-join is the primary path.
// Positional fallback only fires when seoname was absent in the API response.
// ---------------------------------------------------------------------------

function resolveTeamName(
  statKey: string,
  index: number,
  teams: SlateGame["teams"]
): string {
  const direct = teams.find((t) => t.id === statKey);
  if (direct) return direct.name;
  // Fallback: positional — only reached if seoname was missing from boxscore teams[]
  console.warn(
    `[GameDetailDrawer] no team matched statKey "${statKey}" — using position ${index}`
  );
  return teams[index]?.name ?? `Team ${index + 1}`;
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-500 mb-3 mt-6 border-b border-zinc-800 pb-1">
      {children}
    </h3>
  );
}

function Missing({ message }: { message: string }) {
  return (
    <p className="text-xs font-mono text-zinc-600 italic">{message}</p>
  );
}

// ---------------------------------------------------------------------------
// Team Stats comparison table
// ---------------------------------------------------------------------------

interface StatRow {
  label: string;
  a: string;
  b: string;
}

function TeamStatsTable({
  nameA,
  nameB,
  statsA,
  statsB,
}: {
  nameA: string;
  nameB: string;
  statsA: RawTeamStats;
  statsB: RawTeamStats;
}) {
  const rows: StatRow[] = [
    { label: "Points",     a: String(statsA.points),                b: String(statsB.points) },
    { label: "FG%",        a: fmtPct(statsA.fieldGoalPercentage),   b: fmtPct(statsB.fieldGoalPercentage) },
    { label: "FG",         a: fmtFraction(statsA.fieldGoalsMade, statsA.fieldGoalsAttempted), b: fmtFraction(statsB.fieldGoalsMade, statsB.fieldGoalsAttempted) },
    { label: "3PT%",       a: fmtPct(statsA.threePointPercentage),  b: fmtPct(statsB.threePointPercentage) },
    { label: "3PT",        a: fmtFraction(statsA.threePointsMade, statsA.threePointsAttempted), b: fmtFraction(statsB.threePointsMade, statsB.threePointsAttempted) },
    { label: "FT%",        a: fmtPct(statsA.freeThrowPercentage),   b: fmtPct(statsB.freeThrowPercentage) },
    { label: "FT",         a: fmtFraction(statsA.freeThrowsMade, statsA.freeThrowsAttempted), b: fmtFraction(statsB.freeThrowsMade, statsB.freeThrowsAttempted) },
    { label: "Rebounds",   a: String(statsA.totalRebounds),         b: String(statsB.totalRebounds) },
    { label: "Off Reb",    a: String(statsA.offensiveRebounds),     b: String(statsB.offensiveRebounds) },
    { label: "Assists",    a: String(statsA.assists),               b: String(statsB.assists) },
    { label: "Turnovers",  a: String(statsA.turnovers),             b: String(statsB.turnovers) },
    { label: "Steals",     a: String(statsA.steals),                b: String(statsB.steals) },
    { label: "Blocks",     a: String(statsA.blockedShots),          b: String(statsB.blockedShots) },
    { label: "Fouls",      a: String(statsA.personalFouls),         b: String(statsB.personalFouls) },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr>
            <th className="text-left py-1 px-2 text-zinc-600 font-normal w-24"></th>
            <th className="text-right py-1 px-2 text-zinc-300 font-semibold">{nameA}</th>
            <th className="text-right py-1 px-2 text-zinc-300 font-semibold">{nameB}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-zinc-800/60">
              <td className="py-1.5 px-2 text-zinc-500">{row.label}</td>
              <td className="py-1.5 px-2 text-right text-zinc-200 tabular-nums">{row.a}</td>
              <td className="py-1.5 px-2 text-right text-zinc-200 tabular-nums">{row.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player stats table — one per team
// ---------------------------------------------------------------------------

function PlayerStatsTable({
  teamName,
  players,
}: {
  teamName: string;
  players: RawPlayerStats[];
}) {
  const sorted = [...players].sort((a, b) => b.minutesPlayed - a.minutesPlayed);

  return (
    <div className="mb-5">
      <p className="text-[10px] font-mono font-semibold uppercase tracking-widest text-zinc-400 mb-2">
        {teamName}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse min-w-[560px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left py-1 px-1.5 text-zinc-500 font-normal">Name</th>
              <th className="text-center py-1 px-1.5 text-zinc-500 font-normal w-8">Pos</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-10">Min</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">Pts</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">Reb</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">Ast</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">TO</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">Stl</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-9">Blk</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-14">FG</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-14">3PT</th>
              <th className="text-right py-1 px-1.5 text-zinc-500 font-normal w-14">FT</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={`${p.id}-${i}`}
                className={[
                  "border-t border-zinc-800/50",
                  p.starter ? "text-zinc-200" : "text-zinc-400",
                ].join(" ")}
              >
                <td className="py-1 px-1.5 whitespace-nowrap">
                  {p.firstName} {p.lastName}
                  {p.starter && (
                    <span className="ml-1 text-[9px] text-zinc-600">S</span>
                  )}
                </td>
                <td className="py-1 px-1.5 text-center text-zinc-500">{p.position}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.minutesPlayed.toFixed(0)}</td>
                <td className="py-1 px-1.5 text-right tabular-nums font-semibold">{p.points}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.totalRebounds}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.assists}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.turnovers}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.steals}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">{p.blockedShots}</td>
                <td className="py-1 px-1.5 text-right tabular-nums">
                  {fmtFraction(p.fieldGoalsMade, p.fieldGoalsAttempted)}
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums">
                  {fmtFraction(p.threePointsMade, p.threePointsAttempted)}
                </td>
                <td className="py-1 px-1.5 text-right tabular-nums">
                  {fmtFraction(p.freeThrowsMade, p.freeThrowsAttempted)}
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
// Drawer props
// ---------------------------------------------------------------------------

export interface GameDetailDrawerProps {
  game: SlateGame | null;
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// GameDetailDrawer — main export
// ---------------------------------------------------------------------------

export default function GameDetailDrawer({
  game,
  isOpen,
  onClose,
}: GameDetailDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [isOpen, onClose]);

  // Derive display data — all conditional on game being non-null
  const teamEntries = game
    ? Object.entries(game.team_stats_raw)
    : [];
  const playerEntries = game
    ? Object.entries(game.player_stats_raw)
    : [];

  const hasTeamStats = teamEntries.length >= 2;
  const hasPlayerStats = playerEntries.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={[
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Game detail"
        className={[
          "fixed inset-y-0 right-0 z-50 w-[520px] max-w-full",
          "flex flex-col bg-zinc-950 border-l border-zinc-800",
          "transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        {/* ----------------------------------------------------------------- */}
        {/* Header bar                                                         */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex flex-col gap-0.5">
            {game && (
              <>
                {/* Round / region — conditional */}
                {(roundLabel(game.bracketRound) || regionLabel(game.sectionId)) && (
                  <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                    {[roundLabel(game.bracketRound), regionLabel(game.sectionId)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p className="text-sm font-mono font-semibold text-white">
                  {game.description}
                </p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="ml-4 shrink-0 text-zinc-500 hover:text-white transition-colors p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Scrollable body                                                    */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!game && (
            <Missing message="No game selected." />
          )}

          {game && (
            <>
              {/* ----------------------------------------------------------- */}
              {/* Teams + scores                                               */}
              {/* ----------------------------------------------------------- */}
              <div className="flex flex-col gap-2 mb-2">
                {game.teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-2">
                      {team.seed !== null && (
                        <span className="text-[10px] font-mono text-zinc-600 w-4 text-right shrink-0">
                          {team.seed}
                        </span>
                      )}
                      <span
                        className={[
                          "text-base font-semibold",
                          team.winner ? "text-white" : "text-zinc-400",
                        ].join(" ")}
                      >
                        {team.name}
                      </span>
                      {team.winner && game.status === "final" && (
                        <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-green-500 px-1 py-0.5 rounded bg-green-950">
                          W
                        </span>
                      )}
                    </div>
                    <span
                      className={[
                        "text-base font-mono font-semibold tabular-nums",
                        team.winner ? "text-white" : "text-zinc-400",
                      ].join(" ")}
                    >
                      {team.score !== null ? team.score : "—"}
                    </span>
                  </div>
                ))}
              </div>

              {/* ----------------------------------------------------------- */}
              {/* Game meta                                                    */}
              {/* ----------------------------------------------------------- */}
              <div className="mt-3 flex flex-col gap-1.5">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "text-[10px] font-mono font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded",
                      game.status === "live"
                        ? "text-green-400 bg-green-950 animate-pulse"
                        : game.status === "final"
                        ? "text-zinc-300 bg-zinc-800"
                        : "text-zinc-500 bg-zinc-800",
                    ].join(" ")}
                  >
                    {game.status}
                  </span>
                </div>

                {/* Start time */}
                {fmtEpoch(game.startTimeEpoch) && (
                  <MetaRow label="Time">
                    {fmtEpoch(game.startTimeEpoch)!}
                  </MetaRow>
                )}

                {/* Network / broadcaster */}
                {(game.network || game.broadcaster) && (
                  <MetaRow label="Network">
                    {game.network ?? game.broadcaster ?? ""}
                  </MetaRow>
                )}

                {/* Stale notice */}
                {game.stale && (
                  <div className="mt-1 flex items-start gap-2 rounded border border-yellow-800 bg-yellow-950/20 px-3 py-2">
                    <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-yellow-600 shrink-0 mt-0.5">
                      STALE
                    </span>
                    <span className="text-[11px] font-mono text-yellow-700">
                      Last synced: {fmtSync(game.last_synced)}
                    </span>
                  </div>
                )}

                {/* Synced at */}
                {!game.stale && game.last_synced && (
                  <p className="text-[10px] font-mono text-zinc-600">
                    Synced: {fmtSync(game.last_synced)}
                  </p>
                )}
              </div>

              {/* ----------------------------------------------------------- */}
              {/* Team Stats                                                   */}
              {/* ----------------------------------------------------------- */}
              <SectionLabel>Team Stats</SectionLabel>
              {hasTeamStats ? (
                <TeamStatsTable
                  nameA={resolveTeamName(teamEntries[0][0], 0, game.teams)}
                  nameB={resolveTeamName(teamEntries[1][0], 1, game.teams)}
                  statsA={teamEntries[0][1]}
                  statsB={teamEntries[1][1]}
                />
              ) : (
                <Missing message="Team stats not available for this game yet." />
              )}

              {/* ----------------------------------------------------------- */}
              {/* Player Stats                                                 */}
              {/* ----------------------------------------------------------- */}
              <SectionLabel>Player Stats</SectionLabel>
              {hasPlayerStats ? (
                playerEntries.map(([teamId, players], i) => (
                  <PlayerStatsTable
                    key={teamId}
                    teamName={resolveTeamName(teamId, i, game.teams)}
                    players={players}
                  />
                ))
              ) : (
                <Missing message="Player stats not available for this game yet." />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helper — key/value meta row
// ---------------------------------------------------------------------------

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest w-16 shrink-0">
        {label}
      </span>
      <span className="text-xs font-mono text-zinc-300">{children}</span>
    </div>
  );
}
