import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, batch, createSignal } from 'solid-js';
import type { EntitySearchCategory } from '../queries/entity-search';

export type MobileSearchSnapshot = {
  query: string;
  category: EntitySearchCategory;
  mode: 'name' | 'full-text';
};

export interface MobileSearchSession {
  category: Accessor<EntitySearchCategory>;
  setCategory: (category: EntitySearchCategory) => void;
  mode: Accessor<'name' | 'full-text'>;
  searchFullText: () => void;

  /** query (the dock input's live value) */
  query: Accessor<string>;
  setQuery: (value: string) => void;
  snapshot: () => MobileSearchSnapshot;
}

/** Query state belongs to a Search history entry, including while it is covered. */
export function createMobileSearchSession(
  initial?: MobileSearchSnapshot
): MobileSearchSession {
  const [query, writeQuery] = createSignal(initial?.query ?? '');
  const [category, writeCategory] = createSignal<EntitySearchCategory>(
    initial?.category ?? 'all'
  );
  const [mode, setMode] = createSignal<'name' | 'full-text'>(
    initial?.mode ?? 'name'
  );
  const setQuery = (value: string) =>
    batch(() => {
      writeQuery(value);
      if (!value.trim()) setMode('name');
    });
  const setCategory = (value: EntitySearchCategory) =>
    batch(() => {
      writeCategory(value);
      if (value === 'projects') setMode('name');
    });
  const searchFullText = () => {
    if (!query().trim() || category() === 'projects') return;
    const span = Telemetry.span('mobile.search.full_text');
    try {
      span.setAttr('search.category', category());
      span.setAttr('search.query_length', query().trim().length);
      setMode('full-text');
    } finally {
      span.end();
    }
  };

  return {
    query,
    setQuery,
    category,
    setCategory,
    mode,
    searchFullText,
    snapshot: () => ({ query: query(), category: category(), mode: mode() }),
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
    category: () => session().category(),
    setCategory: (value: EntitySearchCategory) => session().setCategory(value),
    mode: () => session().mode(),
    searchFullText: () => session().searchFullText(),
  };
}

/**
 * App chrome controls the foreground Search entry. Opening from the dock
 * creates a session before mounting/focusing its input in the tap handler.
 */
export const SearchState = createMobileSearchState();
