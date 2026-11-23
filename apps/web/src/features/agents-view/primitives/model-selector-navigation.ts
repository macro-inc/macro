import { batch, createEffect, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

export type ModelSelectorPage =
  | 'card'
  | 'list'
  | 'all'
  | 'agents'
  | 'agentModels';

/** The phone sheet and desktop popover share one navigation lifetime. */
export function createModelSelectorNavigation(
  onOpenChange?: (open: boolean) => void,
  anchor?: () => HTMLElement | undefined
) {
  const [state, setState] = createStore({
    open: false,
    query: '',
    page: 'card' as ModelSelectorPage,
  });
  const changeOpen = (open: boolean) => {
    if (open === state.open) return;
    batch(() => {
      setState(open ? { open } : { open, query: '', page: 'card' });
      onOpenChange?.(open);
    });
  };
  onCleanup(() => {
    if (state.open) onOpenChange?.(false);
  });
  // Composer controls can stay mounted while their enclosing row becomes hidden.
  // Watch that row as well as removal; an invisible trigger cannot anchor a card.
  createEffect(() => {
    if (!state.open || !anchor) return;
    const checkAnchor = () => {
      const trigger = anchor();
      if (!trigger?.isConnected) {
        changeOpen(false);
        return;
      }
      for (
        let element: HTMLElement | null = trigger;
        element;
        element = element.parentElement
      ) {
        const style = getComputedStyle(element);
        if (
          element.hidden ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        ) {
          changeOpen(false);
          return;
        }
      }
    };
    checkAnchor();
    if (!state.open) return;
    const observer = new MutationObserver(checkAnchor);
    // Observe only the anchor's ancestry, not every mutation in the app.
    for (
      let element = anchor();
      element;
      element = element.parentElement ?? undefined
    ) {
      observer.observe(element, { attributes: true, childList: true });
    }
    window.addEventListener('resize', checkAnchor);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('resize', checkAnchor);
    });
  });
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
      setState({
        page:
          state.page === 'list' || state.page === 'agentModels'
            ? 'card'
            : 'list',
        query: '',
      }),
  };
}
