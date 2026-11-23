import { registerHotkey } from '@core/hotkey/hotkeys';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useViewTabHotkeys } from './use-view-tab-hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
}));

const command = (key: string) =>
  vi
    .mocked(registerHotkey)
    .mock.calls.findLast(([options]) => options.hotkey === key)![0];
const handler = (key: string) => command(key).keyDownHandler!;
const description = (key: string) => {
  const text = command(key).description;
  return typeof text === 'function' ? text() : text;
};

const keydown = (target: Element) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab' });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

/**
 * A split with its list beside a detail: tabs and a list grid in the main
 * region, a button in each region. jsdom lays nothing out, so the tabs
 * report a box while they count as on screen.
 */
function pane() {
  const split = document.createElement('div');
  split.dataset.hotkeyScope = 'split-test';
  split.innerHTML = `
    <div data-view-shell-aside>
      <aside data-view-sidebar>
        <nav aria-label="Email tabs">
          <button type="button">Inbox</button>
          <button type="button">Favorites</button>
          <button type="button" aria-haspopup="menu">Options</button>
          <input aria-label="View name" />
        </nav>
        <button type="button">New</button>
      </aside>
    </div>
    <div data-view-shell-main>
      <div role="radiogroup" aria-label="Inbox view"></div>
      <button type="button">Filter</button>
      <div role="grid" aria-label="Email" tabindex="0"></div>
    </div>
    <div data-view-shell-detail>
      <div data-hotkey-scope="thread" tabindex="-1"></div>
      <button type="button">Reply</button>
      <p>Here is the plan.</p>
    </div>`;
  const rail = document.createElement('nav');
  rail.dataset.hotkeyScopeNeutral = '';
  rail.innerHTML = '<button type="button">Mail</button>';
  document.body.append(rail, split);
  for (const region of split.querySelectorAll(
    '[data-view-shell-aside], [data-view-shell-main], [data-view-shell-detail]'
  )) {
    Object.defineProperty(region, 'getClientRects', {
      configurable: true,
      value: () => [region.getBoundingClientRect()],
    });
  }
  const tabs = split.querySelector<HTMLElement>('[role="radiogroup"]')!;
  let onScreen = true;
  Object.defineProperty(tabs, 'getClientRects', {
    value: () => (onScreen ? [tabs.getBoundingClientRect()] : []),
  });
  const find = (selector: string) => split.querySelector(selector)!;
  return {
    split,
    tabs,
    grid: find('[role="grid"]'),
    headerButton: find('[data-view-shell-main] button'),
    detail: find('[data-hotkey-scope="thread"]'),
    detailButton: find('[data-view-shell-detail] button'),
    detailText: find('[data-view-shell-detail] p'),
    inbox: find('nav button'),
    favorites: find('nav button + button'),
    options: find('nav [aria-haspopup]'),
    viewName: find('nav input'),
    sidebarNew: find('aside > button'),
    rail: rail.querySelector('button')!,
    hide: () => {
      onScreen = false;
    },
  };
}

const press = (element: Element) =>
  element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
const focus = (element: Element) =>
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
const typeKey = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));

function mailTabs(view: ReturnType<typeof pane>) {
  const move = vi.fn();
  useViewTabHotkeys({
    scopeId: 'split-test',
    tabs: () => view.tabs,
    ids: () => ['focus', 'important', 'noise'],
    activeId: () => 'important',
    setActiveId: move,
    label: (id) => id,
  });
  return move;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.mocked(registerHotkey).mockClear();
});

it('switches tabs only while they are on screen and the keyboard is on their pane', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = vi.fn();
    useViewTabHotkeys({
      scopeId: 'split-test',
      tabs: () => view.tabs,
      ids: () => ['focus', 'important', 'noise'],
      activeId: () => 'important',
      setActiveId: move,
      label: (id) => id.toUpperCase(),
    });

    expect(handler('tab')(keydown(view.grid))).toBe(true);
    expect(move).toHaveBeenLastCalledWith('noise');
    expect(handler('shift+tab')(keydown(document.body))).toBe(true);
    expect(move).toHaveBeenLastCalledWith('focus');
    expect(handler('2')(keydown(view.grid))).toBe(true);
    expect(move).toHaveBeenLastCalledWith('important');
    move.mockClear();

    expect(handler('tab')(keydown(view.headerButton))).toBe(false);
    expect(handler('tab')(keydown(view.detail))).toBe(false);
    expect(handler('tab')(keydown(view.detailButton))).toBe(false);
    expect(handler('3')(keydown(view.headerButton))).toBe(false);
    expect(move).not.toHaveBeenCalled();

    expect(command('tab').condition!()).toBe(true);
    view.hide();
    expect(command('tab').condition!()).toBe(false);
    expect(command('1').condition!()).toBe(false);
    dispose();
  });
});

it('takes the key from what stands for the pane, never from a data grid', () => {
  createRoot((dispose) => {
    const view = pane();
    const main = view.split.querySelector('[data-view-shell-main]')!;
    main.insertAdjacentHTML(
      'beforeend',
      `<div role="table" aria-label="Routines" tabindex="-1"></div>
       <div data-pane-focus tabindex="-1"></div>
       <div role="grid" aria-label="Tasks" data-owns-arrow-keys tabindex="-1"></div>`
    );
    const move = vi.fn();
    useViewTabHotkeys({
      scopeId: 'split-test',
      tabs: () => view.tabs,
      ids: () => ['all', 'on'],
      activeId: () => 'all',
      setActiveId: move,
      label: (id) => id,
    });

    expect(handler('tab')(keydown(main.querySelector('[role="table"]')!))).toBe(
      true
    );
    expect(
      handler('tab')(keydown(main.querySelector('[data-pane-focus]')!))
    ).toBe(true);
    // A database's own grid takes focus with a range of cells selected.
    expect(
      handler('tab')(keydown(main.querySelector('[data-owns-arrow-keys]')!))
    ).toBe(false);
    expect(
      handler('2')(keydown(main.querySelector('[data-owns-arrow-keys]')!))
    ).toBe(false);
    expect(move).toHaveBeenCalledTimes(2);
    dispose();
  });
});

it('names each number key after its tab and offers only the tabs there are', () => {
  createRoot((dispose) => {
    const view = pane();
    useViewTabHotkeys({
      scopeId: 'split-test',
      tabs: () => view.tabs,
      ids: () => ['recent', 'notifications'],
      activeId: () => 'recent',
      setActiveId: vi.fn(),
      label: (id) => (id === 'recent' ? 'Recent' : 'Notifications'),
    });

    expect(description('1')).toBe('Go to Recent');
    expect(description('2')).toBe('Go to Notifications');
    expect(command('2').condition!()).toBe(true);
    expect(command('3').condition!()).toBe(false);
    expect(description('tab')).toBe('Next tab');
    expect(description('shift+tab')).toBe('Previous tab');
    dispose();
  });
});

it('wraps around the tabs and starts from an end when none is active', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = vi.fn();
    const [active, setActive] = createSignal<string | undefined>('noise');
    useViewTabHotkeys({
      scopeId: 'split-test',
      tabs: () => view.tabs,
      ids: () => ['focus', 'important', 'noise'],
      activeId: active,
      setActiveId: move,
      label: (id) => id,
    });

    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('focus');
    setActive('focus');
    expect(handler('shift+tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('noise');
    setActive(undefined);
    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('focus');
    expect(handler('shift+tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('noise');
    dispose();
  });
});

it('leaves the split itself to the pane the user last put the keyboard in', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = vi.fn();
    useViewTabHotkeys({
      scopeId: 'split-test',
      tabs: () => view.tabs,
      ids: () => ['focus', 'important', 'noise'],
      activeId: () => 'important',
      setActiveId: move,
      label: (id) => id,
    });

    expect(handler('tab')(keydown(view.split))).toBe(true);
    press(view.detailText);
    focus(view.split);
    expect(handler('tab')(keydown(view.split))).toBe(false);
    expect(handler('2')(keydown(document.body))).toBe(false);
    // The detail replacing what was pressed keeps the keyboard there.
    view.detailText.remove();
    expect(handler('tab')(keydown(view.split))).toBe(false);
    // A pane no longer laid out (hidden while another takes its place) does not.
    const detail = view.split.querySelector('[data-view-shell-detail]')!;
    Object.defineProperty(detail, 'getClientRects', { value: () => [] });
    expect(handler('tab')(keydown(view.split))).toBe(true);
    focus(view.grid);
    expect(handler('tab')(keydown(view.split))).toBe(true);
    expect(move).toHaveBeenCalledTimes(3);
    dispose();
  });
});

it('leaves the keys to the pane on a sidebar destination a pointer press chose, until the keyboard moves focus', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = mailTabs(view);

    press(view.inbox);
    focus(view.inbox);
    expect(handler('tab')(keydown(view.inbox))).toBe(true);
    expect(handler('2')(keydown(view.inbox))).toBe(true);
    expect(move).toHaveBeenCalledTimes(2);

    typeKey();
    focus(view.favorites);
    expect(handler('tab')(keydown(view.favorites))).toBe(false);
    // Back on the destination by the keyboard, it is focus order too.
    focus(view.inbox);
    expect(handler('tab')(keydown(view.inbox))).toBe(false);
    expect(move).toHaveBeenCalledTimes(2);
    dispose();
  });
});

it('chooses nothing with a keyboard focus, a control that opens something, a field, or a control outside the navigation', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = mailTabs(view);

    focus(view.inbox);
    expect(handler('tab')(keydown(view.inbox))).toBe(false);
    press(view.options);
    focus(view.options);
    expect(handler('tab')(keydown(view.options))).toBe(false);
    press(view.viewName);
    focus(view.viewName);
    expect(handler('tab')(keydown(view.viewName))).toBe(false);
    press(view.sidebarNew);
    focus(view.sidebarNew);
    expect(handler('tab')(keydown(view.sidebarNew))).toBe(false);
    expect(move).not.toHaveBeenCalled();
    dispose();
  });
});

it('ends the choice when the press opens something that takes focus', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = mailTabs(view);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);

    press(view.inbox);
    focus(view.inbox);
    focus(dialog);
    // Focus handed back to the destination as the dialog closes.
    focus(view.inbox);
    expect(handler('tab')(keydown(view.inbox))).toBe(false);
    expect(move).not.toHaveBeenCalled();
    dispose();
  });
});

it('hands the pane the keyboard from a press on the navigation, wherever it was before', () => {
  createRoot((dispose) => {
    const view = pane();
    const move = mailTabs(view);

    press(view.detailText);
    focus(view.split);
    expect(handler('tab')(keydown(view.split))).toBe(false);
    // A browser that focuses no button on a click leaves the split focused.
    press(view.inbox);
    expect(handler('tab')(keydown(view.split))).toBe(true);

    press(view.detailText);
    focus(view.split);
    expect(handler('tab')(keydown(view.split))).toBe(false);
    // The rail hands the split back the destination that had focus.
    press(view.rail);
    focus(view.inbox);
    expect(handler('tab')(keydown(view.inbox))).toBe(true);
    expect(move).toHaveBeenCalledTimes(2);
    dispose();
  });
});
