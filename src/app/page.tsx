"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { PortfolioEntry } from "@/lib/types";

export default function PortfolioPage() {
  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sheets/list")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
        setEntries(json.entries);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load portfolio"));
  }, []);

  const totalValue = entries?.reduce((sum, e) => sum + e.totalValue, 0) ?? 0;
  const totalCards = entries?.reduce((sum, e) => sum + e.quantity, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5 px-4 pt-6">
      <h1 className="text-xl font-semibold">Your Portfolio</h1>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {entries && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-xs text-neutral-500">Total Value</div>
            <div className="text-2xl font-semibold">${totalValue.toFixed(2)}</div>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-xs text-neutral-500">Cards</div>
            <div className="text-2xl font-semibold">{totalCards}</div>
          </div>
        </div>
      )}

      {entries && entries.length === 0 && (
        <div className="flex flex-col items-center gap-3 pt-16 text-center text-neutral-500">
          <span className="text-3xl">🃏</span>
          <p className="text-sm">No cards yet.</p>
          <Link href="/add" className="rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white">
            Scan your first card
          </Link>
        </div>
      )}

      {entries && entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <li
                key={entry.rowIndex}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
              >
                {entry.imageUrl ? (
                  <Image
                    src={entry.imageUrl}
                    alt={entry.cardName}
                    width={44}
                    height={62}
                    className="rounded-md"
                  />
                ) : (
                  <div className="h-[62px] w-[44px] rounded-md bg-neutral-100 dark:bg-neutral-800" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{entry.cardName}</span>
                  <span className="truncate text-xs text-neutral-500">
                    {entry.setName} · #{entry.number} · {entry.condition}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-semibold">${entry.totalValue.toFixed(2)}</span>
                  {entry.quantity > 1 && (
                    <span className="text-xs text-neutral-500">x{entry.quantity}</span>
                  )}
                </div>
              </li>
            ))}
        </ul>
      )}

      {!entries && !error && <p className="text-center text-sm text-neutral-500">Loading…</p>}
    </div>
  );
}
