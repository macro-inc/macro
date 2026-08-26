// @vitest-environment jsdom
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { activeScope, setActiveScope } from '@core/hotkey/state';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ChromeDestination } from './chrome-destinations';
import { registerChromeViewHotkeys } from './chrome-view-hotkeys';

/** Stand-ins for the center row: only id and label are read by the hotkeys. */
const view = (id: string): ChromeDestination =>
  ({
    id,
    label: id,
    content: { type: 'component', id },
    path: `/component/${id}`,
  }) as unknown as ChromeDestination;

const VIEWS = [
  view('activity'),
  view('drive'),
  view('email'),
  view('chat'),
] as const;

let container: HTMLDivElement;
let splitEl: HTMLDivElement;
let splitScopeId: string;
let disposeRoot: () => void;
let disposeHotkeys: () => void;
let opened: string[];
let activeId: string | undefined;
/** Stands in for the soup views' own 1-9, which bind at the split scope. */
let soupDigitsLive: boolean;
let soupDigitsFired: string[];

/** A real trusted-shaped keydown, the way the hotkey root sees one. */
const press = (key: string, options: KeyboardEventInit = {}) => {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, ...options })
  );
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key, bubbles: true, ...options })
  );
};

beforeEach(() => {
  opened = [];
  activeId = undefined;
  soupDigitsLive = false;
  soupDigitsFired = [];

  container = document.createElement('div');
  splitEl = document.createElement('div');
  splitEl.tabIndex = -1;
  container.appendChild(splitEl);
  document.body.appendChild(container);

  disposeRoot = createRoot((dispose) => {
    useHotKeyRoot();
    attachGlobalDOMScope(container);

    const [attachHotkeys, scopeId] = useHotkeyDOMScope('chrome-hotkey-test');
    attachHotkeys(splitEl);
    splitScopeId = scopeId;

    for (let index = 0; index < 9; index++) {
      registerHotkey({
        hotkey: `${index + 1}` as '1',
        scopeId,
        description: `soup tab ${index + 1}`,
        condition: () => soupDigitsLive,
        keyDownHandler: () => {
          soupDigitsFired.push(`${index + 1}`);
          return true;
        },
        hide: true,
      });
    }

    const registrations = registerChromeViewHotkeys({
      views: () => VIEWS,
      isActive: (destination) => destination.id === activeId,
      openView: (destination) => {
        opened.push(destination.id);
        activeId = destination.id;
      },
    });
    disposeHotkeys = () => {
      for (const registration of registrations) registration.dispose();
    };

    return dispose;
  });

  setActiveScope('global');
});

afterEach(() => {
  disposeHotkeys();
  disposeRoot();
  container.remove();
  setActiveScope('global');
  vi.restoreAllMocks();
});

describe('chrome view hotkeys', () => {
  test('a digit opens the view at that position in the row', () => {
    press('3');
    expect(opened).toEqual(['email']);

    press('1');
    expect(opened).toEqual(['email', 'activity']);
  });

  test('a digit past the end of the row does nothing', () => {
    press('9');
    expect(opened).toEqual([]);
  });

  test('tab steps forward from the active view and wraps', () => {
    activeId = 'chat';
    press('Tab');
    expect(opened).toEqual(['activity']);
  });

  test('shift+tab steps backward from the active view and wraps', () => {
    activeId = 'activity';
    press('Tab', { shiftKey: true });
    expect(opened).toEqual(['chat']);
  });

  test('with nothing active, tab lands first and shift+tab lands last', () => {
    press('Tab');
    expect(opened).toEqual(['activity']);

    activeId = undefined;
    press('Tab', { shiftKey: true });
    expect(opened).toEqual(['activity', 'chat']);
  });

  // A calendar or a data table is content, not an overlay: FullCalendar puts
  // role="grid" on its table and role="gridcell" on every focusable day, so
  // treating grids as overlays left the whole calendar view keyless.
  test('a grid in the view does not hold the keys', () => {
    const grid = document.createElement('div');
    grid.setAttribute('role', 'grid');
    const cell = document.createElement('button');
    cell.setAttribute('role', 'gridcell');
    grid.appendChild(cell);
    container.appendChild(grid);
    cell.focus();

    press('3');
    expect(opened).toEqual(['email']);
  });

  test('the keys stay out of the way while focus sits in a menu', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    container.appendChild(menu);
    item.focus();

    press('3');
    press('Tab');
    expect(opened).toEqual([]);
  });

  test('the keys stay out of the way while a text field has focus', () => {
    const input = document.createElement('input');
    container.appendChild(input);
    input.focus();

    press('3');
    expect(opened).toEqual([]);
  });

  test('disposal releases the keys', () => {
    disposeHotkeys();
    disposeHotkeys = () => {};

    press('3');
    expect(opened).toEqual([]);
  });
});

describe('from inside a focused split', () => {
  beforeEach(() => {
    splitEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });

  test('the split scope is the active one', () => {
    expect(activeScope()).toBe(splitScopeId);
  });

  test('a digit reaches the bar once the soup binding stands down', () => {
    press('2');
    expect(soupDigitsFired).toEqual([]);
    expect(opened).toEqual(['drive']);
  });

  test('the soup binding keeps the digit while it is live', () => {
    soupDigitsLive = true;
    press('2');
    expect(soupDigitsFired).toEqual(['2']);
    expect(opened).toEqual([]);
  });
});
