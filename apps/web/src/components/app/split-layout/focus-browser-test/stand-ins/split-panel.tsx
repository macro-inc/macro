import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  SplitHandle,
  SplitState,
} from '@components/app/split-layout/layoutManager';
import { registerSplitHotkeys } from '@components/app/split-layout/registerSplitHotkeys';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createSignal, Match, Switch } from 'solid-js';

/** A list's own scope, which extends its selection with Shift+Up/Down as real lists do. */
function List() {
  const [attach, scopeId] = useHotkeyDOMScope('list');
  const [extended, setExtended] = createSignal(0);
  registerHotkey({
    hotkey: ['shift+arrowdown', 'shift+arrowup'],
    scopeId,
    description: 'Extend selection',
    keyDownHandler: () => {
      setExtended((count) => count + 1);
      return true;
    },
  });

  return (
    <div ref={attach} data-extended={extended()}>
      <button type="button">List row</button>
    </div>
  );
}

/** A database-like grid that extends its cell range with Shift+Arrow. */
function Grid() {
  const [ranged, setRanged] = createSignal(0);

  return (
    <div
      role="grid"
      tabIndex={0}
      data-owns-arrow-keys
      data-ranged={ranged()}
      onKeyDown={(event) => {
        if (event.shiftKey && event.key.startsWith('Arrow')) {
          setRanged((count) => count + 1);
        }
      }}
    >
      Grid
    </div>
  );
}

/**
 * The pane's hotkey scope and split hotkeys as the real panel registers them,
 * without its header, toolbar, and app-wide providers.
 */
export function SplitPanel(props: {
  split: SplitState;
  handle: SplitHandle;
  active: boolean;
  setPanelRef: (ref: HTMLDivElement) => void;
}) {
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );
  const layout = useSplitLayout();
  registerSplitHotkeys({
    splitHotkeyScope,
    insertSplit: () => {},
    closeSplit: () => props.handle.close(),
    toggleSpotlight: () => props.handle.toggleSpotlight(),
    canGoBack: () => false,
    goBack: () => {},
    canGoForward: () => false,
    goForward: () => {},
    goToList: () => {},
    splitName: () => props.split.content.id,
    getSplitCount: () => layout.getSplitCount(),
    isNotUnifiedList: () => true,
  });

  return (
    <div
      ref={(element) => {
        attachHotKeys(element);
        props.setPanelRef(element);
      }}
      tabIndex={-1}
      data-pane={props.split.content.id}
      data-active={props.active}
      style={{ height: '100%', border: '1px solid #888' }}
    >
      <strong>{props.split.content.id}</strong>
      <Switch>
        <Match when={props.split.content.id === 'list'}>
          <List />
        </Match>
        <Match when={props.split.content.id === 'grid'}>
          <Grid />
        </Match>
      </Switch>
      <textarea aria-label={`${props.split.content.id} draft`} />
    </div>
  );
}
