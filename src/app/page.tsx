"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useStoredPortfolioName } from "@/lib/portfolioPreference";
import type { PortfolioEntry } from "@/lib/types";
import PortfolioSelector from "@/components/PortfolioSelector";
import EditEntryModal from "@/components/EditEntryModal";

export default function PortfolioPage() {
  const sheetName = useStoredPortfolioName();

  return (
    <div className="flex flex-col gap-5 px-4 pt-6">
      <h1 className="text-xl font-semibold">Your Portfolio</h1>

      <PortfolioSelector />

      {/* Keyed by sheetName so switching portfolios remounts this with
          fresh (null) entries/error state instead of showing stale data
          from the previous tab while the new one loads. */}
      <PortfolioList key={sheetName} sheetName={sheetName} />
    </div>
  );
}

function PortfolioList({ sheetName }: { sheetName: string }) {
  const [entries, setEntries] = useState<PortfolioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<PortfolioEntry | null>(null);
  const [refreshingPrices, setRefreshingPrices] = useState<"all" | "zero" | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sheets/list?sheet=${encodeURIComponent(sheetName)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
        setEntries(json.entries);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load portfolio"));
  }, [sheetName, refreshToken]);

  async function handleRefreshPrices(onlyZero: boolean) {
    setRefreshingPrices(onlyZero ? "zero" : "all");
    setRefreshMessage(null);
    setError(null);

    // The endpoint only processes a bounded batch per call (see its own
    // comment) so a single request never risks a platform timeout on a
    // large portfolio -- this loops it to completion, showing progress
    // after each batch instead of one long silent wait. Rows already
    // attempted this run are excluded from the next call rather than using
    // a numeric offset: in onlyZero mode, a row this run just priced drops
    // out of the "still $0" set immediately, which would shift everything
    // after it and make offset-based paging skip entries.
    let excludeRows: number[] = [];
    let updatedTotal = 0;
    let attemptedTotal = 0;
    let rateLimited = false;
    try {
      while (true) {
        const res = await fetch("/api/sheets/refresh-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetName, onlyZero, excludeRows }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to refresh prices");

        updatedTotal += json.updatedInBatch;
        attemptedTotal += json.attemptedRows.length;
        excludeRows = [...excludeRows, ...json.attemptedRows];

        // Stop immediately rather than burning through the rest of the list
        // (and the Sheets API calls that come with each batch) once we know
        // the backup source won't answer again until it un-blocks.
        if (json.backupRateLimited) {
          rateLimited = true;
          break;
        }

        setRefreshMessage(
          onlyZero
            ? `Priced ${updatedTotal} of ${attemptedTotal} $0 card${attemptedTotal === 1 ? "" : "s"} checked so far… (${json.remaining} left)`
            : `Updated ${updatedTotal} of ${attemptedTotal} card${attemptedTotal === 1 ? "" : "s"} checked so far… (${json.remaining} left)`
        );

        // json.attemptedRows.length === 0 is a safety net against ever
        // looping forever -- shouldn't happen alongside remaining > 0, but
        // an empty batch with nothing left to exclude would otherwise spin.
        if (json.remaining <= 0 || json.attemptedRows.length === 0) break;
      }
      setRefreshMessage(
        rateLimited
          ? `Priced ${updatedTotal} of ${attemptedTotal} checked before the backup price source hit its rate limit. Try again later.`
          : onlyZero
            ? `Priced ${updatedTotal} of ${attemptedTotal} card${attemptedTotal === 1 ? "" : "s"} that had $0.`
            : `Updated ${updatedTotal} of ${attemptedTotal} card${attemptedTotal === 1 ? "" : "s"}.`
      );
      setRefreshToken((t) => t + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh prices");
    } finally {
      setRefreshingPrices(null);
    }
  }

  const totalValue = entries?.reduce((sum, e) => sum + e.totalValue, 0) ?? 0;
  const totalCards = entries?.reduce((sum, e) => sum + e.quantity, 0) ?? 0;
  const zeroPricedCount = entries?.filter((e) => e.price === 0).length ?? 0;

  return (
    <>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {entries && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
            <div className="text-xs text-neutral-500">⚡ Total Value</div>
            <div className="text-2xl font-semibold">${totalValue.toFixed(2)}</div>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="text-xs text-neutral-500">🎴 Cards</div>
            <div className="text-2xl font-semibold">{totalCards}</div>
          </div>
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => handleRefreshPrices(false)}
            disabled={refreshingPrices !== null}
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
          >
            {refreshingPrices === "all" ? "Refreshing…" : "↻ Refresh Prices"}
          </button>
          {zeroPricedCount > 0 && (
            <button
              onClick={() => handleRefreshPrices(true)}
              disabled={refreshingPrices !== null}
              className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 disabled:opacity-50 dark:border-amber-800 dark:text-amber-400"
            >
              {refreshingPrices === "zero" ? "Pricing…" : `🔧 Fix $0 (${zeroPricedCount})`}
            </button>
          )}
        </div>
      )}

      {refreshMessage && <p className="text-sm text-neutral-500">{refreshMessage}</p>}

      {entries && entries.length === 0 && (
        <div className="flex flex-col items-center gap-3 pt-16 text-center text-neutral-500">
          <span className="text-3xl">🃏</span>
          <p className="text-sm">No cards in &quot;{sheetName}&quot; yet.</p>
          <Link href="/add" className="rounded-full bg-sky-600 px-5 py-2 text-sm font-medium text-white">
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
              <li key={entry.rowIndex}>
                <button
                  onClick={() => setSelectedEntry(entry)}
                  className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5 text-left dark:border-neutral-800 dark:bg-neutral-900"
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
                </button>
              </li>
            ))}
        </ul>
      )}

      {!entries && !error && <p className="text-center text-sm text-neutral-500">Loading…</p>}

      {selectedEntry && (
        <EditEntryModal
          entry={selectedEntry}
          sheetName={sheetName}
          onClose={() => setSelectedEntry(null)}
          onSaved={() => {
            setSelectedEntry(null);
            setRefreshToken((t) => t + 1);
          }}
          onDeleted={() => {
            setSelectedEntry(null);
            setRefreshToken((t) => t + 1);
          }}
        />
      )}
    </>
  );
}
