/** Shared composition for PR, agent-session, and preview Changes hosts. */
import { createSignal, type ParentProps } from 'solid-js';
import type { ChangesContext, PaneViewState } from './context/changes-context';
import { ChangesControllerProvider } from './context/changes-controller';
import { createPaneViewState } from './pane-view-state';
import { createChanges } from './primitives/create-changes';

export type { ChangesHost, ChangesSource } from './context/changes-context';
export { useChanges, useOptionalChanges } from './context/changes-controller';
export {
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from './views/ChangesControls';
export { ChangesPane } from './views/ChangesPane';
export { ChangesSplit } from './views/ChangesSplit';

export function ChangesProvider(
  props: ParentProps<{
    context: ChangesContext;
    view?: PaneViewState;
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  }>
) {
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createChanges({
    context: props.context,
    view: props.view ?? createPaneViewState(),
    storage: props.storage,
    dismissed: [dismissed, (id) => setDismissed(id)],
  });
  return (
    <ChangesControllerProvider value={controller}>
      {props.children}
    </ChangesControllerProvider>
  );
}
