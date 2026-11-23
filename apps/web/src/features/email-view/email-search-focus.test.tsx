import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { useViewTabHotkeys } from '@app/components/view-shell/use-view-tab-hotkeys';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { focusEmailSearchResults } from './email-search-focus';

afterEach(() => setActiveScope('global'));

// The hotkey engine tracks held keys, so every press is released.
function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key, ...init });
  fireEvent.keyUp(target, { key, ...init });
}

/** jsdom lays nothing out, so the tabs report a box to count as on screen. */
function onScreen(element: HTMLElement) {
  Object.defineProperty(element, 'getClientRects', {
    configurable: true,
    value: () => [element.getBoundingClientRect()],
  });
}

/**
 * Email's search field, list and header tabs over the real hotkey engine:
 * the search hands the keyboard to Email's split panel, and Tab moves along
 * the header's tabs while the keyboard is on the pane.
 */
function setup(options: { list?: boolean } = {}) {
  const withList = options.list ?? true;
  const [tab, setTab] = createSignal('noise');
  const [search, setSearch] = createSignal('macro');
  const [tabs, setTabs] = createSignal<HTMLElement>();
  let split!: HTMLDivElement;
  let list: HTMLDivElement | undefined;

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('email-split');
    const panel = {
      isPanelActive: () => true,
      splitHotkeyScope: splitScope,
      panelRef: () => split,
    } as unknown as SplitPanelContextType;

    useViewTabHotkeys({
      scopeId: splitScope,
      tabs,
      ids: () => ['focus', 'important', 'noise'],
      activeId: tab,
      setActiveId: setTab,
      label: (id) => id,
    });
    // The list's own jump to its first row, as use-list-interactions has it.
    if (withList) {
      registerHotkey({
        hotkey: 'home',
        hotkeyToken: TOKENS.entity.jump.home,
        scopeId: splitScope,
        description: 'Go to first item',
        keyDownHandler: () => true,
      });
    }

    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div
          ref={(element) => {
            split = element;
            attachSplit(element);
          }}
          tabIndex={-1}
        >
          <div
            ref={(element) => {
              onScreen(element);
              setTabs(element);
            }}
            role="radiogroup"
            aria-label="Inbox view"
          />
          <button type="button">Filter email</button>
          <SplitPanelContext.Provider value={panel}>
            <ListHeaderSearch
              label="Search email"
              value={search()}
              onValueChange={setSearch}
              focusResults={() => focusEmailSearchResults(panel, list)}
              registerFocus={() => {}}
            />
          </SplitPanelContext.Provider>
          <Show when={withList}>
            <div ref={list} role="grid" aria-label="Email" tabIndex={0}>
              <div role="row">
                <button type="button">teo</button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  const field = () => view.getByRole('searchbox', { name: 'Search email' });
  return { tab, search, field, split: () => split, list: () => list! };
}

it('switches tabs with Tab after Escape leaves the search', () => {
  const { tab, search, field, split } = setup();
  field().focus();

  press('Escape');
  expect(document.activeElement).toBe(split());
  expect(search()).toBe('macro');

  press('Tab');
  expect(tab()).toBe('focus');
  press('Tab', { shiftKey: true });
  expect(tab()).toBe('noise');
});

it('switches tabs with Tab after ArrowDown moves into the results', () => {
  const { tab, field, split } = setup();
  field().focus();

  press('ArrowDown');
  expect(document.activeElement).toBe(split());

  press('Tab');
  expect(tab()).toBe('focus');
});

it('switches tabs with Tab while the list itself has focus', () => {
  const { tab, list } = setup();
  list().focus();

  press('Tab');
  expect(tab()).toBe('focus');
  press('Tab', { shiftKey: true });
  expect(tab()).toBe('noise');
});

it('switches tabs with Tab while nothing has focus', () => {
  const { tab, split } = setup();
  split().focus();
  (document.activeElement as HTMLElement).blur();

  press('Tab');
  expect(tab()).toBe('focus');
});

it('keeps Tab for the browser on a control inside a row', () => {
  const { tab, list } = setup();
  list().querySelector('button')!.focus();

  press('Tab');
  expect(tab()).toBe('noise');
  press('Tab', { shiftKey: true });
  expect(tab()).toBe('noise');
});

it('keeps ArrowDown with the field while no list is on screen', () => {
  const { field } = setup({ list: false });
  field().focus();

  press('ArrowDown');
  expect(document.activeElement).toBe(field());
});

it('keeps Tab for the browser on a header control', () => {
  const { tab, split } = setup();
  split().querySelector<HTMLButtonElement>('button')!.focus();

  press('Tab');
  expect(tab()).toBe('noise');
  press('Tab', { shiftKey: true });
  expect(tab()).toBe('noise');
});

it('keeps Tab for the browser while the tabs are off screen', () => {
  const { tab, list } = setup();
  const tabs = document.querySelector<HTMLElement>(
    '[aria-label="Inbox view"]'
  )!;
  Object.defineProperty(tabs, 'getClientRects', { value: () => [] });
  list().focus();

  press('Tab');
  expect(tab()).toBe('noise');
});
