"use client";

import { useState } from "react";
import BracketTab from "@/components/BracketTab";
import GameProjectionsTab from "@/components/GameProjectionsTab";
import PlayerProjectionsTab from "@/components/PlayerProjectionsTab";
import BettingTab from "@/components/BettingTab";

type TabId = "bracket" | "game-projections" | "player-projections" | "betting";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "bracket", label: "Bracket" },
  { id: "game-projections", label: "Game Projections" },
  { id: "player-projections", label: "Player Projections" },
  { id: "betting", label: "Betting Lines" },
];

interface BlockedTabProps {
  message: string;
}

function BlockedTab({ message }: BlockedTabProps) {
  return (
    <div className="flex items-start gap-3 rounded border border-zinc-700 bg-zinc-900 px-5 py-4 mt-6">
      <span className="mt-0.5 shrink-0 text-xs font-mono font-semibold uppercase tracking-widest text-zinc-500">
        BLOCKED
      </span>
      <p className="text-sm text-zinc-400 leading-relaxed">{message}</p>
    </div>
  );
}

export default function DashboardTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("bracket");

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-zinc-950 text-zinc-100 font-mono">
      {/* Tab bar */}
      <div className="border-b border-zinc-800 px-4 flex gap-1 shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "px-4 py-3 text-xs font-semibold uppercase tracking-widest transition-colors",
                isActive
                  ? "border-b-2 border-white text-white"
                  : "text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-auto px-4 py-4">
        {activeTab === "bracket" && <BracketTab />}

        {activeTab === "game-projections" && <GameProjectionsTab />}

        {activeTab === "player-projections" && <PlayerProjectionsTab />}

        {activeTab === "betting" && <BettingTab />}
      </div>
    </div>
  );
}
