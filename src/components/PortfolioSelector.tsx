"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SHEET_NAME,
  setStoredPortfolio,
  useStoredPortfolioName,
} from "@/lib/portfolioPreference";

const NEW_PORTFOLIO_VALUE = "__new__";

export default function PortfolioSelector() {
  const value = useStoredPortfolioName();
  const [tabs, setTabs] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sheets/tabs")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load portfolios");
        const list: string[] = json.tabs.length > 0 ? json.tabs : [DEFAULT_SHEET_NAME];
        setTabs(list);
        if (!list.includes(value)) {
          setStoredPortfolio(list[0]);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load portfolios"));
    // Only meant to run once on mount to populate the tab list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === NEW_PORTFOLIO_VALUE) {
      setCreating(true);
      return;
    }
    setStoredPortfolio(val);
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create portfolio");
      setTabs(json.tabs);
      setStoredPortfolio(trimmed);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create portfolio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={tabs?.includes(value) ? value : ""}
        onChange={handleSelectChange}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium dark:border-neutral-700 dark:bg-neutral-900"
      >
        {!tabs && <option value="">Loading portfolios…</option>}
        {tabs?.map((tab) => (
          <option key={tab} value={tab}>
            {tab}
          </option>
        ))}
        <option value={NEW_PORTFOLIO_VALUE}>+ New portfolio…</option>
      </select>

      {creating && (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New portfolio name"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
            className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {busy ? "Creating…" : "Create"}
          </button>
          <button
            onClick={() => {
              setCreating(false);
              setNewName("");
              setError(null);
            }}
            className="rounded-lg px-2 text-sm text-neutral-500"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
