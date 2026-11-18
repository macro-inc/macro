import { createStore } from 'solid-js/store';

export type ModelSelectorPage = 'list' | 'all' | 'model' | 'effort' | 'speed';

/** Both selector presentations reset their local navigation only on dismissal. */
export function createModelSelectorNavigation(
  onOpenChange?: (open: boolean) => void
) {
  const [state, setState] = createStore({
    open: false,
    query: '',
    page: 'list' as ModelSelectorPage,
  });
  const changeOpen = (open: boolean) => {
    setState(open ? { open } : { open, query: '', page: 'list' });
    onOpenChange?.(open);
  };
  return {
    open: () => state.open,
    query: () => state.query,
    page: () => state.page,
    setQuery: (query: string) => setState('query', query),
    setPage: (page: ModelSelectorPage) => setState('page', page),
    changeOpen,
    back: () => setState({ page: 'list', query: '' }),
  };
}
