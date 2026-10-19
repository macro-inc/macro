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
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  );
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

it('shows and hides the reading pane with Shift+V', () => {
  const [readingPane, setReadingPane] = createSignal(false);
  const view = render(() => {
    useHotKeyRoot();
    const [attachEmail, emailScope] = useHotkeyDOMScope('email-split');
    useReadingPaneHotkey({
      scopeId: emailScope,
      enabled: () => true,
      readingPane,
      setReadingPane,
    });
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachEmail} tabIndex={0} data-testid="email" />
      </div>
    );
  });
  view.getByTestId('email').focus();

  press('V', { shiftKey: true });
  expect(readingPane()).toBe(true);
  press('V', { shiftKey: true });
  expect(readingPane()).toBe(false);
});
