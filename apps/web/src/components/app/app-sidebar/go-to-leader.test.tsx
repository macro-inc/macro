import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { activeScope, setActiveScope } from '@core/hotkey/state';
import { render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isGoToLeaderActive, useGoToLeader } from './go-to-leader';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setActiveScope('global');
});

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup() {
  function Harness() {
    setHotkeyRoot(useHotKeyRoot());
    const [attachSplit] = useHotkeyDOMScope('split');
    const goToLeader = useGoToLeader();
    // g a: the destination's composer mounts and takes focus a moment later,
    // as Agents does.
    registerHotkey({
      hotkey: 'a',
      scopeId: GO_TO_COMMAND_SCOPE,
      description: 'Go to Agents',
      keyDownHandler: () => {
        goToLeader.leave();
        setTimeout(() =>
          document
            .querySelector<HTMLElement>('[data-testid="composer"]')
            ?.focus()
        );
        return true;
      },
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachSplit} tabIndex={0} data-testid="split">
          <div contentEditable tabIndex={0} data-testid="composer" />
        </div>
      </div>
    );
  }
  return render(() => <Harness />);
}

it('keeps focus on a destination reached before the hints show', () => {
  const view = setup();
  view.getByTestId('split').focus();

  press('g');
  press('a');
  vi.advanceTimersByTime(0);
  expect(document.activeElement).toBe(view.getByTestId('composer'));

  vi.advanceTimersByTime(3000);
  expect(document.activeElement).toBe(view.getByTestId('composer'));
  expect(isGoToLeaderActive()).toBe(false);
});

it('keeps focus on a destination reached after the hints show', () => {
  const view = setup();
  view.getByTestId('split').focus();

  press('g');
  vi.advanceTimersByTime(300);
  expect(isGoToLeaderActive()).toBe(true);
  press('a');
  vi.advanceTimersByTime(0);
  expect(document.activeElement).toBe(view.getByTestId('composer'));

  vi.advanceTimersByTime(3000);
  expect(document.activeElement).toBe(view.getByTestId('composer'));
  expect(isGoToLeaderActive()).toBe(false);
});

it('leaves the GoTo scope when no destination follows', () => {
  const view = setup();
  view.getByTestId('split').focus();

  press('g');
  vi.advanceTimersByTime(300);
  expect(activeScope()).toBe(GO_TO_COMMAND_SCOPE);

  vi.advanceTimersByTime(2000);
  expect(activeScope()).not.toBe(GO_TO_COMMAND_SCOPE);
  expect(isGoToLeaderActive()).toBe(false);
});
