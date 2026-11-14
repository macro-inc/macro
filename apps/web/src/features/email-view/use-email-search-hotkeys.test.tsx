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

function press(key: string, init: KeyboardEventInit = {}) {
  const keydown = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(
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
      showList: () => {
        handled.push('show list');
        setListOnScreen(true);
      },
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
        </div>
      </div>
    );
  });
  view.getByTestId('email').focus();

  return { handled, setListOnScreen, setCanSearch };
}

it('focuses the list search while the list is on screen', () => {
  const email = renderEmail();

  press('/');

  expect(email.handled).toEqual(['list search']);
});

it('returns to the list and focuses its search once a thread replaces the list', () => {
  const email = renderEmail();
  email.setListOnScreen(false);

  press('/');

  expect(email.handled).toEqual(['show list', 'list search']);
});

it('focuses the returning list search once per press', () => {
  const email = renderEmail();
  email.setListOnScreen(false);
  press('/');

  email.setListOnScreen(false);
  email.setListOnScreen(true);

  expect(email.handled).toEqual(['show list', 'list search']);
});

it('returns to the list search when the list comes back', () => {
  const email = renderEmail();
  email.setListOnScreen(false);
  email.setListOnScreen(true);

  press('/');

  expect(email.handled).toEqual(['list search']);
});

it('leaves the key to the search view on a tab without search', () => {
  const email = renderEmail();
  email.setCanSearch(false);

  press('/');

  expect(email.handled).toEqual(['search view']);
});

it('focuses the list search with Cmd+F while the list is on screen', () => {
  const email = renderEmail();

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
