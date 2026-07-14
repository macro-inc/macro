import { useUserId } from '@core/context/user';
import { createEffect, createSignal, on } from 'solid-js';

/** Dismissible home surfaces. Dismissals persist in localStorage. */
export type HomeCard = 'examples' | 'setup';

const STORAGE_KEY = 'macro:home:dismissed';
const HOME_CARDS: readonly HomeCard[] = ['examples', 'setup'];

export function parseDismissedCards(raw: string | null): HomeCard[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (card): card is HomeCard =>
        typeof card === 'string' && HOME_CARDS.includes(card as HomeCard)
    );
  } catch {
    return [];
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY}:${encodeURIComponent(userId)}`;
}

function load(userId: string | undefined): HomeCard[] {
  if (!userId) return [];
  if (typeof localStorage === 'undefined') return [];
  try {
    return parseDismissedCards(localStorage.getItem(storageKey(userId)));
  } catch {
    return [];
  }
}

function persist(userId: string | undefined, cards: Set<HomeCard>): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...cards]));
  } catch {
    // Storage may be unavailable or full. The in-memory preference still works.
  }
}

export type HomePreferences = ReturnType<typeof createHomePreferences>;

/** User-scoped, reactive dismissal preferences for the home surface. */
export function createHomePreferences() {
  const userId = useUserId();
  const [dismissed, setDismissed] = createSignal<Set<HomeCard>>(new Set());

  createEffect(
    on(userId, (id) => {
      setDismissed(new Set(load(id)));
    })
  );

  const update = (card: HomeCard, shouldDismiss: boolean) => {
    setDismissed((previous) => {
      if (previous.has(card) === shouldDismiss) return previous;
      const next = new Set(previous);
      if (shouldDismiss) next.add(card);
      else next.delete(card);
      persist(userId(), next);
      return next;
    });
  };

  return {
    isDismissed: (card: HomeCard) => dismissed().has(card),
    dismiss: (card: HomeCard) => update(card, true),
    restore: (card: HomeCard) => update(card, false),
  };
}
