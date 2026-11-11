import {
  createListController,
  useListInteractions,
} from '@app/components/list';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { activeScope, setActiveScope } from '@core/hotkey/state';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import { render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { useEmailListHotkeys } from './use-email-list-hotkeys';

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

afterEach(() => setActiveScope('global'));

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup() {
  const leader = vi.fn(() => true);
  let list!: ReturnType<typeof createListController<{ id: string }>>;

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('email-split');
    const [attachReader, readerScope] = useHotkeyDOMScope('email-reader');
    // The sidebar's go-to leader.
    registerHotkey({
      hotkey: GO_TO_LEADER_KEY,
      scopeId: 'global',
      description: 'Go to',
      keyDownHandler: leader,
      activateCommandScopeId: GO_TO_COMMAND_SCOPE,
      registrationType: 'add',
      hide: true,
    });
    const readerHasKeyboard = () => isScopeInActiveBranch(readerScope);
    list = createListController({
      items: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      getKey: (item) => item.id,
    });
    const interactions = useListInteractions({
      controller: list,
      scopeId: splitScope,
      scrollHandle: () => undefined,
      enabled: () => !readerHasKeyboard(),
    });
    useEmailListHotkeys({
      scopeId: splitScope,
      enabled: () => !readerHasKeyboard(),
      selectedEntities: () => [],
      clearSelection: interactions.selection.clear,
      readerHasKeyboard,
      goToFirst: interactions.navigation.first,
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachSplit} tabIndex={-1}>
          <div tabIndex={0} data-testid="list" />
          <div ref={attachReader} tabIndex={0} data-testid="reader" />
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  return { view, leader, list: () => list };
}

it.each(['list', 'reader'])(
  'goes to the first email with g g from the %s',
  (target) => {
    const { view, leader, list } = setup();
    view.getByTestId(target).focus();
    list().focus.set('c');

    press('g');
    press('g');

    expect(list().focus.key()).toBe('a');
    expect(leader).toHaveBeenCalledOnce();
    expect(activeScope()).not.toBe(GO_TO_COMMAND_SCOPE);
  }
);
