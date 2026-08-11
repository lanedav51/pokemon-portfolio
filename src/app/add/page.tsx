"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { fileToResizedBase64 } from "@/lib/image";
import type { AddCardPayload, CardCondition, CardSearchResult } from "@/lib/types";

const CONDITIONS: CardCondition[] = [
  "Mint",
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];

type Status = "idle" | "scanning" | "searching" | "submitting" | "success" | "error";

export default function AddCardPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchNumber, setSearchNumber] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);

  const [condition, setCondition] = useState<CardCondition>("Near Mint");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState<number>(0);
  const [notes, setNotes] = useState("");

  async function runSearch(query: string, number: string) {
    if (!query.trim()) return;
    setStatus("searching");
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({ q: query });
      if (number.trim()) params.set("number", number.trim());
      const res = await fetch(`/api/cards/search?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.results);
      setHasSearched(true);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Search failed");
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedCard(null);
    setResults([]);
    setHasSearched(false);
    setStatus("scanning");
    setErrorMessage(null);

    try {
      const base64 = await fileToResizedBase64(file);
      setPhotoPreview(`data:image/jpeg;base64,${base64}`);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "OCR failed");

      const guessedName = json.guessedName ?? "";
      const guessedNumber: string | null = json.guessedNumber ?? null;
      const guessedTotal: string | null = json.guessedTotal ?? null;
      const guessedFraction = guessedNumber ? [guessedNumber, guessedTotal].filter(Boolean).join("/") : "";
      setSearchQuery(guessedName);
      setSearchNumber(guessedFraction);
      await runSearch(guessedName, guessedFraction);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Scan failed");
    }
  }

  function selectCard(card: CardSearchResult) {
    setSelectedCard(card);
    setPrice(card.marketPrice ?? 0);
  }

  function resetForm() {
    setPhotoPreview(null);
    setSearchQuery("");
    setSearchNumber("");
    setResults([]);
    setHasSearched(false);
    setSelectedCard(null);
    setCondition("Near Mint");
    setQuantity(1);
    setPrice(0);
    setNotes("");
    setStatus("idle");
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    if (!selectedCard) return;
    setStatus("submitting");
    setErrorMessage(null);

    const payload: AddCardPayload = {
      cardId: selectedCard.id,
      cardName: selectedCard.name,
      setName: selectedCard.setName,
      number: selectedCard.number,
      condition,
      quantity,
      price,
      notes,
      imageUrl: selectedCard.imageLarge,
    };

    try {
      const res = await fetch("/api/sheets/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to save");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 px-4 pt-16 text-center">
        <div className="text-4xl">✅</div>
        <h1 className="text-xl font-semibold">Added to your portfolio</h1>
        <p className="text-sm text-neutral-500">
          {selectedCard?.name} was saved to your Google Sheet.
        </p>
        <button
          onClick={resetForm}
          className="mt-4 rounded-full bg-red-600 px-6 py-2.5 font-medium text-white"
        >
          Scan another card
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-6">
      <h1 className="text-xl font-semibold">Add a Card</h1>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        className="hidden"
        id="photo-input"
      />

      {!photoPreview ? (
        <label
          htmlFor="photo-input"
          className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-white py-16 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        >
          <span className="text-3xl">📷</span>
          <span className="text-sm font-medium">Take or upload a photo</span>
        </label>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoPreview} alt="Card photo" className="w-full object-cover" />
          <label
            htmlFor="photo-input"
            className="absolute bottom-2 right-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white"
          >
            Retake
          </label>
        </div>
      )}

      {status === "scanning" && (
        <p className="text-center text-sm text-neutral-500">Scanning card…</p>
      )}

      {photoPreview && status !== "scanning" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Card name"
              className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <input
              value={searchNumber}
              onChange={(e) => setSearchNumber(e.target.value)}
              placeholder="184/159"
              className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <button
            onClick={() => runSearch(searchQuery, searchNumber)}
            disabled={status === "searching"}
            className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {status === "searching" ? "Searching…" : "Search"}
          </button>
        </div>
      )}

      {errorMessage && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {hasSearched && results.length === 0 && !selectedCard && status === "idle" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          No cards found for that name/number. Try clearing the number field, or double-check the
          spelling against the photo.
        </p>
      )}

      {results.length > 0 && !selectedCard && (
        <div className="grid grid-cols-3 gap-2">
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => selectCard(card)}
              className="flex flex-col items-center gap-1 rounded-xl border border-neutral-200 bg-white p-2 text-center dark:border-neutral-800 dark:bg-neutral-900"
            >
              <Image
                src={card.imageSmall}
                alt={card.name}
                width={80}
                height={112}
                className="rounded-md"
              />
              <span className="line-clamp-2 text-[11px] font-medium">{card.name}</span>
              <span className="text-[10px] text-neutral-500">{card.setName}</span>
            </button>
          ))}
        </div>
      )}

      {selectedCard && (
        <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex gap-3">
            <Image
              src={selectedCard.imageSmall}
              alt={selectedCard.name}
              width={70}
              height={98}
              className="rounded-md"
            />
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">{selectedCard.name}</span>
              <span className="text-xs text-neutral-500">
                {selectedCard.setName} · #{selectedCard.number}
              </span>
              {selectedCard.marketPrice != null && (
                <span className="text-xs text-neutral-500">
                  Market: ${selectedCard.marketPrice.toFixed(2)} ({selectedCard.priceSource})
                </span>
              )}
              <button
                onClick={() => setSelectedCard(null)}
                className="mt-1 self-start text-xs font-medium text-red-600 dark:text-red-400"
              >
                Change card
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500">
              Condition
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as CardCondition)}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {CONDITIONS.map((c) => (
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
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value) || 0)}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
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

          <button
            onClick={handleSubmit}
            disabled={status === "submitting"}
            className="rounded-full bg-red-600 px-4 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {status === "submitting" ? "Saving…" : "Add to Portfolio"}
          </button>
        </div>
      )}
    </div>
  );
}
