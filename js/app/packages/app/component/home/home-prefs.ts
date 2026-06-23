import { createSignal } from 'solid-js';

/** Dismissible home surfaces. Dismissals persist in localStorage. */
export type HomeCard = 'examples' | 'setup';

const STORAGE_KEY = 'macro:home:dismissed';

function load(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

const [dismissed, setDismissed] = createSignal<Set<string>>(new Set(load()));

/** Reactive: whether a home card has been dismissed by the user. */
export function isDismissed(card: HomeCard): boolean {
  return dismissed().has(card);
}

/** Dismiss a home card and persist the preference. */
export function dismissCard(card: HomeCard): void {
  setDismissed((prev) => {
    if (prev.has(card)) return prev;
    const next = new Set(prev).add(card);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    }
    return next;
  });
}

/** Restore a dismissed card (used to undo / reset). */
export function restoreCard(card: HomeCard): void {
  setDismissed((prev) => {
    if (!prev.has(card)) return prev;
    const next = new Set(prev);
    next.delete(card);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    }
    return next;
  });
}
