import { useGoToLeader } from '@app/components/app/app-sidebar/go-to-leader';
import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { getShortcutSheet } from '@core/hotkey/getCommands';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { useCalendarHotkeys } from './use-calendar-hotkeys';

afterEach(() => {
  cleanup();
  setActiveScope('global');
});

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

it('keeps app navigation sequences reachable from Calendar and lists the date shortcut', () => {
  const goToDate = vi.fn();
  const home = vi.fn();
  const inbox = vi.fn();
  let scopeId = '';
  const view = render(() => {
    setHotkeyRoot(useHotKeyRoot());
    const [attach, scope] = useHotkeyDOMScope('calendar-shortcut-test');
    scopeId = scope;
    const leader = useGoToLeader();
    for (const [key, handler, label] of [
      ['h', home, 'Go to Home'],
      ['i', inbox, 'Go to Inbox'],
    ] as const) {
      registerHotkey({
        scopeId: GO_TO_COMMAND_SCOPE,
        hotkey: key,
        description: label,
        keyDownHandler: () => {
          handler();
          leader.leave();
          return true;
        },
      });
    }
    useCalendarHotkeys({
      scopeId,
      changeView: vi.fn(),
      previousPeriod: vi.fn(),
      nextPeriod: vi.fn(),
      navigateToToday: vi.fn(),
      goToDate,
    });
    return (
      <div ref={attachGlobalDOMScope}>
        <div ref={attach} tabindex={0} data-testid="calendar" />
      </div>
    );
  });
  view.getByTestId('calendar').focus();
  press('g');
  press('h');
  expect(home).toHaveBeenCalledOnce();
  view.getByTestId('calendar').focus();
  press('g');
  press('i');
  expect(inbox).toHaveBeenCalledOnce();
  expect(goToDate).not.toHaveBeenCalled();

  view.getByTestId('calendar').focus();
  press('y');
  expect(goToDate).toHaveBeenCalledOnce();
  expect(getShortcutSheet(scopeId).view).toContainEqual({
    description: 'Go to date',
    bindings: [['y']],
  });
});
