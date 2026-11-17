import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, onCleanup, Show } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { useEmailSearchHotkeys } from './use-email-search-hotkeys';

afterEach(() => {
  cleanup();
  setActiveScope('global');
});

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document
) {
  const keydown = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(keydown);
  target.dispatchEvent(
    new KeyboardEvent('keyup', { key, bubbles: true, ...init })
  );
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
  return keydown;
}

function ListHeader(props: {
  registerSearch: (focus: () => void) => () => void;
  onFocus: () => void;
}) {
  onCleanup(props.registerSearch(props.onFocus));
  return <div data-testid="list-header" />;
}

function renderEmail() {
  const [listOnScreen, setListOnScreen] = createSignal(true);
  const [canSearch, setCanSearch] = createSignal(true);
  const handled: string[] = [];

  const view = render(() => {
    useHotKeyRoot();
    const [attachEmail, emailScope] = useHotkeyDOMScope('email-split');
    registerHotkey({
      hotkey: '/',
      scopeId: 'global',
      description: 'Go to search view',
      keyDownHandler: () => {
        handled.push('search view');
        return true;
      },
    });
    const search = useEmailSearchHotkeys({
      scopeId: emailScope,
      enabled: () => true,
      canSearch,
    });

    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachEmail} tabIndex={0} data-testid="email">
          <Show when={listOnScreen()}>
            <ListHeader
              registerSearch={search.registerListSearch}
              onFocus={() => handled.push('list search')}
            />
          </Show>
          <textarea aria-label="Reply" />
        </div>
      </div>
    );
  });
  view.getByTestId('email').focus();

  return {
    handled,
    setListOnScreen,
    setCanSearch,
    reply: view.getByRole('textbox', { name: 'Reply' }),
  };
}

it('opens the search view with / while the list is on screen', () => {
  const email = renderEmail();

  press('/');

  expect(email.handled).toEqual(['search view']);
});

it('opens the search view with / once a thread or new email replaces the list', () => {
  const email = renderEmail();
  email.setListOnScreen(false);

  press('/');

  expect(email.handled).toEqual(['search view']);
});

it('opens the search view with / on a tab without search', () => {
  const email = renderEmail();
  email.setCanSearch(false);

  press('/');

  expect(email.handled).toEqual(['search view']);
});

it('leaves / typed in a text field to the field', () => {
  const email = renderEmail();
  email.reply.focus();

  const keydown = press('/', {}, email.reply);

  expect(email.handled).toEqual([]);
  expect(keydown.defaultPrevented).toBe(false);
});

it('focuses the list search with Cmd+F while the list is on screen', () => {
  const email = renderEmail();

  const keydown = press('f', { ctrlKey: true });

  expect(email.handled).toEqual(['list search']);
  expect(keydown.defaultPrevented).toBe(true);
});

it('focuses the returning list search with Cmd+F once the list comes back', () => {
  const email = renderEmail();
  email.setListOnScreen(false);
  email.setListOnScreen(true);

  const keydown = press('f', { ctrlKey: true });

  expect(email.handled).toEqual(['list search']);
  expect(keydown.defaultPrevented).toBe(true);
});

it('leaves Cmd+F to the browser once a thread replaces the list', () => {
  const email = renderEmail();
  email.setListOnScreen(false);

  const keydown = press('f', { ctrlKey: true });

  expect(email.handled).toEqual([]);
  expect(keydown.defaultPrevented).toBe(false);
});
