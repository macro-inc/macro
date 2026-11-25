import {
  type SearchOperatorBinding,
  searchBindingsIn,
} from '@app/features/next-soup/core/search-operators';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, batch, createSignal } from 'solid-js';
import { shouldUseUniversalInputForSearch } from '../core/universal-input-mode';

export type MobileSearchSnapshot = {
  query: string;
  mode: 'name' | 'full-text';
  universalInputActive?: boolean;
  /** What the opener's tokens in `query` stand for, by id. */
  bindings?: SearchOperatorBinding[];
};

export interface MobileSearchSession {
  /** A promoted input stays in composer mode until cleared; UI checks the rollout flag. */
  universalInputActive: Accessor<boolean>;
  mode: Accessor<'name' | 'full-text'>;
  searchFullText: () => void;

  /** query (the dock input's live value) */
  query: Accessor<string>;
  setQuery: (value: string) => void;
  /** The opener's bindings its tokens still hold; an edited token lets go. */
  bindings: Accessor<SearchOperatorBinding[]>;
  snapshot: () => MobileSearchSnapshot;
}

/** Query state belongs to a Search history entry, including while it is covered. */
export function createMobileSearchSession(
  initial?: MobileSearchSnapshot
): MobileSearchSession {
  const [query, writeQuery] = createSignal(initial?.query ?? '');
  // A session that starts unpromoted, such as one an opener searches, stays a
  // search until the person edits it.
  const [universalInputActive, setUniversalInputActive] = createSignal(
    initial?.universalInputActive !== false &&
      shouldUseUniversalInputForSearch(
        initial?.query ?? '',
        initial?.universalInputActive
      )
  );
  const [mode, setMode] = createSignal<'name' | 'full-text'>(
    initial?.mode ?? 'name'
  );
  const [bindings, setBindings] = createSignal(
    searchBindingsIn(initial?.query ?? '', initial?.bindings ?? [])
  );
  const setQuery = (value: string) =>
    batch(() => {
      writeQuery(value);
      setBindings((kept) => {
        const next = searchBindingsIn(value, kept);
        return next.length === kept.length ? kept : next;
      });
      setUniversalInputActive((active) =>
        shouldUseUniversalInputForSearch(value, active)
      );
      if (!value.trim()) setMode('name');
    });
  const searchFullText = () => {
    if (!query().trim()) return;
    const span = Telemetry.span('mobile.search.full_text');
    try {
      span.setAttr('search.query_length', query().trim().length);
      setMode('full-text');
    } finally {
      span.end();
    }
  };

  return {
    universalInputActive,
    query,
    setQuery,
    bindings,
    mode,
    searchFullText,
    snapshot: () => ({
      query: query(),
      mode: mode(),
      universalInputActive: universalInputActive(),
      bindings: bindings(),
    }),
  };
}

export function createMobileSearchState() {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [session, setSession] = createSignal(createMobileSearchSession());
  return {
    isOpen,
    session,
    open: () => {
      if (isOpen()) return;
      batch(() => {
        setSession(createMobileSearchSession());
        setIsOpen(true);
      });
    },
    close: () => {
      batch(() => {
        setIsOpen(false, false);
        setSession(createMobileSearchSession());
      });
    },
    resume: (value: MobileSearchSession) => {
      batch(() => {
        setSession(value);
        setIsOpen(true);
      });
    },
    suspend: (value: MobileSearchSession) => {
      if (session() === value) setIsOpen(false, false);
    },
    query: () => session().query(),
    setQuery: (value: string) => session().setQuery(value),
    mode: () => session().mode(),
    searchFullText: () => session().searchFullText(),
  };
}

/**
 * App chrome controls the foreground Search entry. Opening from the dock
 * creates a session before mounting/focusing its input in the tap handler.
 */
export const SearchState = createMobileSearchState();
