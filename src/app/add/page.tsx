"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fileToResizedBase64 } from "@/lib/image";
import { useStoredPortfolioName } from "@/lib/portfolioPreference";
import {
  CARD_CONDITIONS,
  type AddCardPayload,
  type CardCondition,
  type CardSearchResult,
  type PortfolioEntry,
} from "@/lib/types";
import PortfolioSelector from "@/components/PortfolioSelector";

type Status = "idle" | "scanning" | "searching" | "submitting" | "success" | "error";

const OCR_TIMEOUT_MS = 25000;

export default function AddCardPage() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const sheetName = useStoredPortfolioName();

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
  const [wasMerge, setWasMerge] = useState(false);
  const [priceLookupBusy, setPriceLookupBusy] = useState(false);

  // Used for duplicate detection: does the selected card + condition already
  // exist as a row in this portfolio? Refetched after every successful save
  // so back-to-back adds of the same card still detect each other.
  const [existingEntries, setExistingEntries] = useState<PortfolioEntry[]>([]);
  const [entriesRefreshToken, setEntriesRefreshToken] = useState(0);

  useEffect(() => {
    // Guards against an out-of-order response: sheetName briefly holds the
    // SSR-safe default ("Portfolio") before syncing to the real client
    // value right after hydration, firing this effect twice in quick
    // succession. If that first (stale) request happens to resolve AFTER
    // the second (correct) one, it would silently overwrite the right data
    // with the wrong sheet's entries without this cancellation flag.
    let cancelled = false;
    fetch(`/api/sheets/list?sheet=${encodeURIComponent(sheetName)}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setExistingEntries(json.entries ?? []);
      })
      .catch(() => {
        // Best-effort: duplicate detection just won't trigger if this fails.
      });
    return () => {
      cancelled = true;
    };
  }, [sheetName, entriesRefreshToken]);

  const duplicate = selectedCard
    ? existingEntries.find((e) => e.cardId === selectedCard.id && e.condition === condition)
    : undefined;

  // Used as a fallback price when pokemontcg.io has no market data for this
  // card (common for very new or low-volume prints): if you've priced this
  // exact card before -- any condition, in this portfolio -- reuse that
  // instead of defaulting to $0.
  const priorPriceForCard = selectedCard
    ? existingEntries.find((e) => e.cardId === selectedCard.id)?.price
    : undefined;

  async function runSearch(query: string, number: string) {
    if (!query.trim() && !number.trim()) return;
    setStatus("searching");
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
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
      // The photo is already captured and previewed at this point, and the
      // name/number fields below are always editable — so a scan failure
      // (including a timeout on a slow mobile connection) doesn't strand
      // the user, it just means they fill in / correct the search manually.
      setStatus("idle");
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setErrorMessage(
        timedOut
          ? "Scanning took too long. Enter the card name/number below to search manually."
          : err instanceof Error
            ? `${err.message} — you can still search manually below.`
            : "Scan failed — you can still search manually below."
      );
    }
  }

  async function selectCard(card: CardSearchResult) {
    setSelectedCard(card);

    if (card.marketPrice != null) {
      setPrice(card.marketPrice);
      return;
    }

    // The search results list doesn't do a backup-price lookup per result
    // (that'd be one extra API call per card shown, most of which nobody
    // picks) -- only for the one card actually selected, via the same
    // getCardById route the per-card refresh button uses, which already
    // falls back to a secondary pricing source when pokemontcg.io has none.
    setPriceLookupBusy(true);
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(card.id)}`);
      const json = await res.json();
      if (res.ok && json.card?.marketPrice != null) {
        setSelectedCard(json.card);
        setPrice(json.card.marketPrice);
        return;
      }
    } catch {
      // Best-effort: fall through to the prior-price/manual-entry fallback below.
    } finally {
      setPriceLookupBusy(false);
    }

    const priorEntry = existingEntries.find((e) => e.cardId === card.id);
    setPrice(priorEntry?.price ?? 0);
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
    setWasMerge(false);
    setStatus("idle");
    setErrorMessage(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (libraryInputRef.current) libraryInputRef.current.value = "";
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
      sheetName,
    };

    try {
      const res = await fetch("/api/sheets/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setWasMerge(false);
      setStatus("success");
      setEntriesRefreshToken((t) => t + 1);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function handleMerge() {
    if (!duplicate) return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/sheets/entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetName,
          rowIndex: duplicate.rowIndex,
          condition,
          quantity: duplicate.quantity + quantity,
          price,
          notes: notes.trim() ? notes : duplicate.notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      setWasMerge(true);
      setStatus("success");
      setEntriesRefreshToken((t) => t + 1);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to update");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-center gap-4 px-4 pt-16 text-center">
        <div className="text-4xl">✅</div>
        <h1 className="text-xl font-semibold">{wasMerge ? "Quantity updated" : "Added to your portfolio"}</h1>
        <p className="text-sm text-neutral-500">
          {wasMerge
            ? `${selectedCard?.name} quantity was updated in "${sheetName}".`
            : `${selectedCard?.name} was saved to "${sheetName}".`}
        </p>
        <button
          onClick={resetForm}
          className="mt-4 rounded-full bg-sky-600 px-6 py-2.5 font-medium text-white"
        >
          Scan another card
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-6">
      <h1 className="text-xl font-semibold">Add a Card</h1>

      <PortfolioSelector />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-neutral-500">Photo (optional — auto-fills the fields below)</span>

        {/* Two separate inputs: `capture` forces the camera straight open on
            most mobile browsers and — critically — hides the "choose from
            library" option from the native picker, so it can't be on the
            one input used for both actions. Triggered via an explicit
            button click + ref.click() rather than a <label htmlFor>, which
            has had reliability issues activating hidden file inputs inside
            an iOS home-screen-installed (standalone) PWA. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
          className="hidden"
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="hidden"
        />

        {!photoPreview ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-white py-10 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <span className="text-3xl">📷</span>
              <span className="text-sm font-medium">Take Photo</span>
            </button>
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-white py-10 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <span className="text-3xl">🖼️</span>
              <span className="text-sm font-medium">Choose from Library</span>
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="Card photo" className="w-full object-cover" />
            <div className="absolute bottom-2 right-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => libraryInputRef.current?.click()}
                className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white"
              >
                Library
              </button>
            </div>
          </div>
        )}

        {status === "scanning" && (
          <p className="text-center text-sm text-neutral-500">Scanning card…</p>
        )}
      </div>

      {status !== "scanning" && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-neutral-500">Card name / number (either one works)</span>
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Card name (optional)"
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
            disabled={status === "searching" || (!searchQuery.trim() && !searchNumber.trim())}
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
              {priceLookupBusy ? (
                <span className="text-xs text-neutral-500">Looking up price…</span>
              ) : selectedCard.marketPrice != null ? (
                <span className="text-xs text-neutral-500">
                  Market: ${selectedCard.marketPrice.toFixed(2)} (
                  {selectedCard.priceSource === "backup" ? "backup source" : selectedCard.priceSource})
                </span>
              ) : priorPriceForCard != null ? (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  No live market price — reused your last recorded price (${priorPriceForCard.toFixed(2)})
                </span>
              ) : (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  No market price found — enter your own below
                </span>
              )}
              <button
                onClick={() => setSelectedCard(null)}
                className="mt-1 self-start text-xs font-medium text-sky-600 dark:text-sky-400"
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
              <input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value) || 0)}
                className={`rounded-lg border bg-white px-2 py-2 text-sm dark:bg-neutral-900 ${
                  selectedCard.marketPrice == null
                    ? "border-amber-400 dark:border-amber-700"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
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

          {duplicate && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              You already have {duplicate.quantity} of this card ({condition}) in &quot;{sheetName}&quot;.
            </p>
          )}

          {duplicate ? (
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={status === "submitting" || priceLookupBusy}
                className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50 dark:border-neutral-700"
              >
                Add as New Row
              </button>
              <button
                onClick={handleMerge}
                disabled={status === "submitting" || priceLookupBusy}
                className="flex-1 rounded-full bg-sky-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {status === "submitting" ? "Saving…" : `Merge (→ ${duplicate.quantity + quantity})`}
              </button>
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={status === "submitting" || priceLookupBusy}
              className="rounded-full bg-sky-600 px-4 py-2.5 font-medium text-white disabled:opacity-50"
            >
              {status === "submitting" ? "Saving…" : "Add to Portfolio"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
