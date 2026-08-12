"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useStoredPortfolioName } from "@/lib/portfolioPreference";
import type { HistoryPoint, PortfolioEntry } from "@/lib/types";
import PortfolioSelector from "@/components/PortfolioSelector";
import ValueHistoryChart from "@/components/ValueHistoryChart";

export default function StatsPage() {
  const sheetName = useStoredPortfolioName();

  return (
    <div className="flex flex-col gap-5 px-4 pt-6">
      <h1 className="text-xl font-semibold">Stats</h1>

      <PortfolioSelector />

      {/* Keyed by sheetName so switching portfolios remounts with fresh state. */}
      <StatsContent key={sheetName} sheetName={sheetName} />
    </div>
  );
}

function StatsContent({ sheetName }: { sheetName: string }) {
  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/sheets/list?sheet=${encodeURIComponent(sheetName)}`).then((r) => r.json()),
      fetch(`/api/sheets/history?sheet=${encodeURIComponent(sheetName)}`).then((r) => r.json()),
    ])
      .then(([listJson, historyJson]) => {
        if (listJson.error) throw new Error(listJson.error);
        if (historyJson.error) throw new Error(historyJson.error);
        setEntries(listJson.entries);
        setHistory(historyJson.history);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"));
  }, [sheetName]);

  if (error) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {error}
      </p>
    );
  }

  if (!entries || !history) {
    return <p className="text-center text-sm text-neutral-500">Loading…</p>;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 pt-16 text-center text-neutral-500">
        <span className="text-3xl">📈</span>
        <p className="text-sm">No cards in &quot;{sheetName}&quot; yet.</p>
      </div>
    );
  }

  const totalValue = entries.reduce((sum, e) => sum + e.totalValue, 0);
  const totalQuantity = entries.reduce((sum, e) => sum + e.quantity, 0);
  const avgPerCard = totalQuantity > 0 ? totalValue / totalQuantity : 0;

  const topCards = entries
    .slice()
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 5);

  const byCondition = new Map<string, { count: number; value: number }>();
  for (const entry of entries) {
    const key = entry.condition || "Unknown";
    const existing = byCondition.get(key) ?? { count: 0, value: 0 };
    existing.count += entry.quantity;
    existing.value += entry.totalValue;
    byCondition.set(key, existing);
  }
  const conditionRows = [...byCondition.entries()].sort((a, b) => b[1].value - a[1].value);

  return (
    <>
      <ValueHistoryChart points={history} />

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="text-xs text-neutral-500">⚡ Total Value</div>
          <div className="text-lg font-semibold">${totalValue.toFixed(0)}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">🎴 Cards</div>
          <div className="text-lg font-semibold">{totalQuantity}</div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xs text-neutral-500">💰 Avg / Card</div>
          <div className="text-lg font-semibold">${avgPerCard.toFixed(0)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">Top Cards</span>
        <ul className="flex flex-col gap-2">
          {topCards.map((entry) => (
            <li
              key={entry.rowIndex}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              {entry.imageUrl ? (
                <Image src={entry.imageUrl} alt={entry.cardName} width={40} height={56} className="rounded-md" />
              ) : (
                <div className="h-[56px] w-[40px] rounded-md bg-neutral-100 dark:bg-neutral-800" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{entry.cardName}</span>
                <span className="truncate text-xs text-neutral-500">{entry.setName}</span>
              </div>
              <span className="text-sm font-semibold">${entry.totalValue.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">By Condition</span>
        <div className="flex flex-col divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {conditionRows.map(([condition, stats]) => (
            <div key={condition} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{condition}</span>
              <span className="text-neutral-500">
                {stats.count} card{stats.count === 1 ? "" : "s"} · ${stats.value.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
