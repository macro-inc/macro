import { createAssertedContextProvider } from '@core/context/createContext';
import type { ContextProviderProps } from '@solid-primitives/context';
import { createSignal } from 'solid-js';
import {
  type GettingStartedStore,
  localStorageGettingStartedStore,
} from './getting-started-store';

export type GettingStartedState = ReturnType<typeof createGettingStartedState>;

/**
 * User-scoped, reactive Getting Started progress: which actions the user has
 * completed (by click or observed event) and which sections they collapsed.
 * Derived completions (connection state, name set) layer on top in the
 * runtime and are never persisted here.
 */
export function createGettingStartedState(
  userId: string,
  store: GettingStartedStore = localStorageGettingStartedStore
) {
  const snapshot = store.load(userId);
  const [completed, setCompleted] = createSignal<ReadonlySet<string>>(
    new Set(snapshot?.completedActionIds)
  );
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(
    new Set(snapshot?.collapsedSectionIds)
  );

  const persist = () => {
    store.save(userId, {
      completedActionIds: [...completed()],
      collapsedSectionIds: [...collapsed()],
    });
  };

  const markCompleted = (actionId: string) => {
    if (completed().has(actionId)) return;
    setCompleted((previous) => new Set(previous).add(actionId));
    persist();
  };

  const toggleSection = (sectionId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
    persist();
  };

  return {
    isPersistedComplete: (actionId: string) => completed().has(actionId),
    markCompleted,
    isCollapsed: (sectionId: string) => collapsed().has(sectionId),
    toggleSection,
  };
}

type GettingStartedProviderProps = ContextProviderProps & {
  userId: string;
  store?: GettingStartedStore;
};

export const [GettingStartedProvider, useGettingStartedState] =
  createAssertedContextProvider<
    GettingStartedState,
    GettingStartedProviderProps
  >('GettingStartedState', (props) =>
    createGettingStartedState(props.userId, props.store)
  );
