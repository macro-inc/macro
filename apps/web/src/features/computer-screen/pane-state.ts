import {
  createSearchParams,
  useOwnsSearchNamespace,
} from '@app/lib/split-router';
import { createSignal } from 'solid-js';
import { screenSearch } from './screen-search';

export function createScreenPaneState() {
  if (!useOwnsSearchNamespace(screenSearch.namespace)()) {
    const [open, setOpen] = createSignal(false);
    return { open, setOpen };
  }
  const [search, setSearch] = createSearchParams(screenSearch);
  return {
    open: () => search.pane === 'split',
    setOpen: (open: boolean) =>
      setSearch({ pane: open ? 'split' : 'closed' }, { history: 'push' }),
  };
}
