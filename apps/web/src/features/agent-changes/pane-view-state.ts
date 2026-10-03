import {
  createSearchParams,
  useOwnsSearchNamespace,
} from '@app/lib/split-router';
import { createSignal } from 'solid-js';
import { changesSearch } from './changes-search';
import type { PaneViewState } from './context/agent-changes-context';
import type { DiffStyle, PaneLayout } from './core/layout';

/** View state that lives only as long as the host, starting closed. */
export function createLocalPaneViewState(): PaneViewState {
  const [layout, setLayout] = createSignal<PaneLayout>('closed');
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
  return { layout, setLayout, diffStyle, setDiffStyle };
}

/**
 * View state in the split's URL when its route owns `changesSearch`, so a
 * copied URL, a reload, and Back/Forward restore the pane; local elsewhere,
 * such as a preview. Opening and closing the pane are history entries;
 * switching the diff style replaces the current one.
 */
export function createPaneViewState(): PaneViewState {
  if (!useOwnsSearchNamespace(changesSearch.namespace)()) {
    return createLocalPaneViewState();
  }
  const [search, setSearch] = createSearchParams(changesSearch);
  return {
    layout: () => search.pane,
    setLayout: (pane) => setSearch({ pane }, { history: 'push' }),
    diffStyle: () => search.style,
    setDiffStyle: (style) => setSearch({ style }, { history: 'replace' }),
  };
}
