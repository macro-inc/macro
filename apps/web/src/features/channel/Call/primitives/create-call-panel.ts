import { type Accessor, createEffect, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CallPanelTab } from '../chat/components/CallChatPanel';

type CallPanelState = {
  open: boolean;
  mounted: boolean;
  tab: CallPanelTab;
  focusOnOpen: boolean;
};

export function createCallPanel(
  opensByDefault: Accessor<boolean>,
  restoreFocus: () => void
) {
  const [state, setState] = createStore<CallPanelState>({
    open: false,
    mounted: false,
    tab: 'chat',
    focusOnOpen: true,
  });
  const open = (focusOnOpen: boolean, tab = state.tab) =>
    setState({ open: true, mounted: true, tab, focusOnOpen });
  const close = () => {
    setState('open', false);
    restoreFocus();
  };
  createEffect(
    on(opensByDefault, (value) => {
      if (value) open(false);
    })
  );
  return {
    state,
    open,
    close,
    toggle: () => (state.open ? close() : open(true)),
    selectTab: (tab: CallPanelTab) => setState({ tab, focusOnOpen: false }),
  };
}
