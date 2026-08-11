import { useSyncExternalStore } from "react";

const STORAGE_KEY = "activePortfolio";
export const DEFAULT_SHEET_NAME = "Portfolio";

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(onStoreChange: Listener) {
  listeners.add(onStoreChange);
  // Covers changes made from another tab/window; same-tab changes are
  // notified directly by setStoredPortfolio below, since the native
  // `storage` event never fires in the tab that made the change.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SHEET_NAME;
}

function getServerSnapshot(): string {
  return DEFAULT_SHEET_NAME;
}

export function setStoredPortfolio(name: string): void {
  window.localStorage.setItem(STORAGE_KEY, name);
  listeners.forEach((listener) => listener());
}

/**
 * The currently selected portfolio (sheet tab), read reactively from
 * localStorage. Using useSyncExternalStore instead of a useState+useEffect
 * pair avoids a hydration mismatch (React renders the server snapshot on
 * first paint, then the real client value) without ever calling setState
 * inside an effect.
 */
export function useStoredPortfolioName(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
