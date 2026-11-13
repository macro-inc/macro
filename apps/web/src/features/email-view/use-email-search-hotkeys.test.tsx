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

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function ListHeader(props: {
  registerSearch: (focus: () => void) => () => void;
  onFocus: () => void;
}) {
  onCleanup(props.registerSearch(props.onFocus));
  return <div data-testid="list-header" />;
}

function renderEmail(options: { sidebarAvailable: boolean }) {
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
      openSidebarSearch: () => {
        if (!options.sidebarAvailable) return false;

        handled.push('sidebar search');
        return true;
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
  const email = renderEmail({ sidebarAvailable: true });

  press('/');

  expect(email.handled).toEqual(['list search']);
});

it('opens the sidebar search once a thread replaces the list', () => {
  const email = renderEmail({ sidebarAvailable: true });
  email.setListOnScreen(false);

  press('/');

  expect(email.handled).toEqual(['sidebar search']);
});

it('returns to the list search when the list comes back', () => {
  const email = renderEmail({ sidebarAvailable: true });
  email.setListOnScreen(false);
  email.setListOnScreen(true);

  press('/');

  expect(email.handled).toEqual(['list search']);
});

it('leaves the key to the search view when Email has no search field to show', () => {
  const email = renderEmail({ sidebarAvailable: false });
  email.setListOnScreen(false);

  press('/');

  expect(email.handled).toEqual(['search view']);
});

it('leaves the key to the search view on a tab without search', () => {
  const email = renderEmail({ sidebarAvailable: true });
  email.setCanSearch(false);

  press('/');

  expect(email.handled).toEqual(['search view']);
});
