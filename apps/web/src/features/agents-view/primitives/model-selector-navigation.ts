import { createStore } from 'solid-js/store';

export type ModelSelectorPage = 'card' | 'list' | 'all' | 'agents';

/** The phone sheet and desktop popover share one navigation lifetime. */
export function createModelSelectorNavigation(
  onOpenChange?: (open: boolean) => void
) {
  const [state, setState] = createStore({
    open: false,
    query: '',
    page: 'card' as ModelSelectorPage,
  });
  const changeOpen = (open: boolean) => {
    if (open === state.open) return;
    setState(open ? { open } : { open, query: '', page: 'card' });
    onOpenChange?.(open);
  };
  return {
    open: () => state.open,
    query: () => state.query,
    page: () => state.page,
    setQuery: (query: string) => setState('query', query),
    setPage: (page: ModelSelectorPage) => setState({ page, query: '' }),
    changeOpen,
    escape: () =>
      state.page === 'card'
        ? changeOpen(false)
        : setState({ page: 'card', query: '' }),
    back: () =>
      setState({ page: state.page === 'list' ? 'card' : 'list', query: '' }),
  };
}
