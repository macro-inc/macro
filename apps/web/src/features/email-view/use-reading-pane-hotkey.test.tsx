import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { useReadingPaneHotkey } from './use-reading-pane-hotkey';

afterEach(() => {
  cleanup();
  setActiveScope('global');
});

function press(key: string, init: KeyboardEventInit = {}) {
  const keydown = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  return keydown;
}

function renderEmail(readerHasKeyboard = () => false) {
  const [readingPane, setReadingPane] = createSignal(false);
  const view = render(() => {
    useHotKeyRoot();
    const [attachEmail, emailScope] = useHotkeyDOMScope('email-split');
    useReadingPaneHotkey({
      scopeId: emailScope,
      enabled: () => true,
      readingPane,
      setReadingPane,
      readerHasKeyboard,
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachEmail} tabIndex={0} data-testid="email" />
      </div>
    );
  });
  view.getByTestId('email').focus();
  return readingPane;
}

it('shows and hides the reading pane with Shift+V', () => {
  const readingPane = renderEmail();

  press('V', { shiftKey: true });
  expect(readingPane()).toBe(true);
  press('V', { shiftKey: true });
  expect(readingPane()).toBe(false);
});

it('shows and hides the reading pane with Space', () => {
  const readingPane = renderEmail();

  expect(press(' ').defaultPrevented).toBe(true);
  expect(readingPane()).toBe(true);
  press(' ');
  expect(readingPane()).toBe(false);
});

it('leaves Space to scroll the thread while the reader has the keyboard', () => {
  const readingPane = renderEmail(() => true);

  expect(press(' ').defaultPrevented).toBe(false);
  expect(readingPane()).toBe(false);

  press('V', { shiftKey: true });
  expect(readingPane()).toBe(true);
});
