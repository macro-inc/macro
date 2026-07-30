import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createEffect, createSignal, on } from 'solid-js';

/** Dismissible home surfaces. Dismissals persist in localStorage. */
export type HomeCard = 'examples' | 'setup';

const storage = createUserScopedStorage('macro:home:dismissed');
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

function load(userId: string | undefined): HomeCard[] {
  if (!userId) return [];
  return parseDismissedCards(storage.read(userId));
}

function persist(userId: string | undefined, cards: Set<HomeCard>): void {
  if (!userId) return;
  storage.write(userId, JSON.stringify([...cards]));
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
