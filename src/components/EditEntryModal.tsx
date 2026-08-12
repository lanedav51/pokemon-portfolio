"use client";

import { useState } from "react";
import Image from "next/image";
import { CARD_CONDITIONS, type CardCondition, type PortfolioEntry } from "@/lib/types";

interface EditEntryModalProps {
  entry: PortfolioEntry;
  sheetName: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export default function EditEntryModal({ entry, sheetName, onClose, onSaved, onDeleted }: EditEntryModalProps) {
  const [condition, setCondition] = useState<CardCondition | string>(entry.condition);
  const [quantity, setQuantity] = useState(entry.quantity);
  const [price, setPrice] = useState(entry.price);
  const [notes, setNotes] = useState(entry.notes);
  const [busy, setBusy] = useState<"saving" | "deleting" | "refreshing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRefreshPrice() {
    setBusy("refreshing");
    setError(null);
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(entry.cardId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch price");
      if (json.card.marketPrice != null) {
        setPrice(json.card.marketPrice);
      } else {
        setError("No current market price is available for this card.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch price");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("saving");
    setError(null);
    try {
      const res = await fetch("/api/sheets/entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName, rowIndex: entry.rowIndex, condition, quantity, price, notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      onSaved();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remove ${entry.cardName} from "${sheetName}"?`)) return;
    setBusy("deleting");
    setError(null);
    try {
      const res = await fetch("/api/sheets/entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName, rowIndex: entry.rowIndex }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete");
      onDeleted();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-t-2xl bg-white p-4 pb-6 sm:rounded-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          {entry.imageUrl ? (
            <Image src={entry.imageUrl} alt={entry.cardName} width={60} height={84} className="rounded-md" />
          ) : (
            <div className="h-[84px] w-[60px] rounded-md bg-neutral-100 dark:bg-neutral-800" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{entry.cardName}</span>
            <span className="text-xs text-neutral-500">
              {entry.setName} · #{entry.number}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            Condition
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            Quantity
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
            Price (USD)
            <div className="flex gap-1">
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value) || 0)}
                className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                type="button"
                onClick={handleRefreshPrice}
                disabled={busy !== null || !entry.cardId}
                title="Fetch current market price"
                className="shrink-0 rounded-lg border border-neutral-300 px-2 text-sm disabled:opacity-50 dark:border-neutral-700"
              >
                {busy === "refreshing" ? "…" : "↻"}
              </button>
            </div>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium dark:border-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={busy !== null}
            className="flex-1 rounded-full border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
          >
            {busy === "deleting" ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={handleSave}
            disabled={busy !== null}
            className="flex-1 rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
