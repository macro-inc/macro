import { createAssertedContextProvider } from '@core/context/createContext';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import type { ContextProviderProps } from '@solid-primitives/context';
import { type Accessor, createMemo, createSignal } from 'solid-js';

/** Dismissible home surfaces. Dismissals persist in localStorage. */
export type HomeCard = 'examples' | 'setup' | 'getting-started-link';

const storage = createUserScopedStorage('macro:home:dismissed');
const HOME_CARDS: readonly HomeCard[] = [
  'examples',
  'setup',
  'getting-started-link',
];

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
export function createHomePreferences(userId: Accessor<string | undefined>) {
  const state = createMemo(() => {
    const id = userId();
    const [dismissed, setDismissed] = createSignal(new Set(load(id)));

    const update = (card: HomeCard, shouldDismiss: boolean) => {
      setDismissed((previous) => {
        if (previous.has(card) === shouldDismiss) return previous;
        const next = new Set(previous);
        if (shouldDismiss) next.add(card);
        else next.delete(card);
        persist(id, next);
        return next;
      });
    };

    return { dismissed, update };
  });

  return {
    isDismissed: (card: HomeCard) => state().dismissed().has(card),
    dismiss: (card: HomeCard) => state().update(card, true),
    restore: (card: HomeCard) => state().update(card, false),
  };
}

/** One preference instance shared by every Home surface in the app. */
export const [HomePreferencesProvider, useHomePreferences] =
  createAssertedContextProvider<
    HomePreferences,
    ContextProviderProps & { userId: Accessor<string | undefined> }
  >('HomePreferences', (props) => createHomePreferences(props.userId));
