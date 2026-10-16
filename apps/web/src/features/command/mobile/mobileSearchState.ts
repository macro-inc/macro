import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, batch, createSignal } from 'solid-js';
import type { EntitySearchCategory } from '../queries/entity-search';

interface IMobileSearchState {
  /**
   * Whether a search session is active — from the dock's search button until
   * the input's X is pressed (or a result opens). Blurring the input only
   * drops the keyboard; it never ends the session.
   */
  isOpen: Accessor<boolean>;
  open: () => void;
  close: () => void;

  category: Accessor<EntitySearchCategory>;
  setCategory: (category: EntitySearchCategory) => void;
  mode: Accessor<'name' | 'full-text'>;
  searchFullText: () => void;

  /** query (the dock input's live value) */
  query: Accessor<string>;
  setQuery: (value: string) => void;
}

export function createMobileSearchState(): IMobileSearchState {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [query, writeQuery] = createSignal('');
  const [category, writeCategory] = createSignal<EntitySearchCategory>('all');
  const [mode, setMode] = createSignal<'name' | 'full-text'>('name');
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

  function open() {
    if (isOpen()) return;
    batch(() => {
      writeQuery('');
      writeCategory('all');
      setMode('name');
      setIsOpen(true);
    });
  }

  /**
   * Ends and resets the session. Passes `shouldReturnFocus: false` — the
   * dock mounts and focuses the input when opening; restoring focus during
   * teardown could re-raise the keyboard.
   */
  function close() {
    batch(() => {
      setIsOpen(false, false);
      writeQuery('');
      writeCategory('all');
      setMode('name');
    });
  }

  return {
    isOpen,
    open,
    close,

    query,
    setQuery,
    category,
    setCategory,
    mode,
    searchFullText,
  };
}

/**
 * Global mobile search session singleton — the dock input whose query feeds
 * the Search route's transient entity and full-text search.
 */
export const SearchState = createMobileSearchState();
