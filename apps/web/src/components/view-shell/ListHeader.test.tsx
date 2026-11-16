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
import { HOTKEY_PRIORITY_HIGH } from '@core/hotkey/types';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ListHeaderSearch } from './ListHeader';
import { clearListSearch, hasListSearch } from './list-search-escape';

afterEach(() => setActiveScope('global'));

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

// The hotkey engine tracks held keys, so every press is released.
function type(field: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(field, { key, ...init });
  fireEvent.keyUp(field, { key });
}

function setup(
  options: { search?: string; selected?: number; overridden?: boolean } = {}
) {
  const [search, setSearch] = createSignal(options.search ?? '');
  const [selected, setSelected] = createSignal(options.selected ?? 0);
  const focusResults = vi.fn();
  const goToFirst = vi.fn(() => true);
  const backToDefaultTab = vi.fn(() => true);
  let list!: HTMLDivElement;

  function Search(props: { scopeId: string }) {
    return (
      <SplitPanelContext.Provider
        value={
          {
            isPanelActive: () => true,
            splitHotkeyScope: props.scopeId,
          } as unknown as SplitPanelContextType
        }
      >
        <ListHeaderSearch
          label="Search tasks"
          value={search()}
          onValueChange={setSearch}
          focusResults={() => {
            focusResults();
            list.focus();
          }}
          registerFocus={() => {}}
        />
      </SplitPanelContext.Provider>
    );
  }

  // The unified list takes over its split's Escape after the header mounts,
  // which eclipses every Escape registered before it.
  function LaterOverride(props: { scopeId: string }) {
    if (!options.overridden) return null;

    registerHotkey({
      hotkey: 'escape',
      scopeId: props.scopeId,
      description: 'Dismiss',
      condition: () => selected() > 0 || hasListSearch(props.scopeId),
      keyDownHandler: () => {
        if (selected() > 0) {
          setSelected(0);
          return true;
        }

        return clearListSearch(props.scopeId);
      },
    });
    return null;
  }

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('tasks-split');
    // The list's own Escape steps, as use-list-interactions and a view
    // register them: clear a selection first, leave the view last.
    // The list's own jump to its first row, as use-list-interactions has it.
    registerHotkey({
      hotkey: 'home',
      hotkeyToken: TOKENS.entity.jump.home,
      scopeId: splitScope,
      description: 'Go to first item',
      keyDownHandler: goToFirst,
    });
    registerHotkey({
      hotkey: 'escape',
      scopeId: splitScope,
      description: 'Leave the tab',
      condition: () => selected() === 0 && !search().trim(),
      keyDownHandler: backToDefaultTab,
      registrationType: 'add',
    });
    registerHotkey({
      hotkey: 'escape',
      scopeId: splitScope,
      description: 'Clear selection',
      condition: () => selected() > 0,
      keyDownHandler: () => {
        setSelected(0);
        return true;
      },
      registrationType: 'add',
      handlerPriority: HOTKEY_PRIORITY_HIGH,
    });

    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        {/* The split takes focus for its list, as a panel does. */}
        <div
          ref={(element) => {
            list = element;
            attachSplit(element);
          }}
          tabIndex={0}
        >
          <Search scopeId={splitScope} />
          <LaterOverride scopeId={splitScope} />
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  const field = () => view.getByRole('searchbox', { name: 'Search tasks' });
  return {
    view,
    field,
    search,
    selected,
    focusResults,
    goToFirst,
    backToDefaultTab,
    list: () => list,
  };
}

it('moves from the field to the first result on ArrowDown and on Enter', () => {
  const { field, search, goToFirst, list } = setup({ search: 'budget' });

  field().focus();
  type(field(), 'ArrowDown');
  expect(document.activeElement).toBe(list());
  expect(goToFirst).toHaveBeenCalledTimes(1);

  field().focus();
  type(field(), 'Enter');
  expect(document.activeElement).toBe(list());
  expect(goToFirst).toHaveBeenCalledTimes(2);
  expect(search()).toBe('budget');
});

it('turns off the browser history popup that would take the arrow keys', () => {
  const { field } = setup({ search: 'budget' });

  expect(field().getAttribute('autocomplete')).toBe('off');
});

it('leaves modified and composing keys to the field', () => {
  const { field, focusResults } = setup({ search: 'budget' });

  field().focus();
  type(field(), 'Enter', { isComposing: true });
  type(field(), 'ArrowDown', { shiftKey: true });
  expect(focusResults).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field());
});

it('keeps the search when Escape leaves the field', () => {
  const { view, field, search, goToFirst, list } = setup({
    search: 'budget',
  });

  field().focus();
  type(field(), 'Escape');

  expect(search()).toBe('budget');
  // The list keeps the row it was on.
  expect(goToFirst).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(list());
  expect(view.getByRole('searchbox', { name: 'Search tasks' })).toBeTruthy();
});

it('clears the search on Escape in the list, after a selection', () => {
  const { view, search, selected, backToDefaultTab, list } = setup({
    search: 'budget',
    selected: 2,
  });
  list().focus();

  press('Escape');
  expect(selected()).toBe(0);
  expect(search()).toBe('budget');

  press('Escape');
  expect(search()).toBe('');
  expect(view.queryByRole('searchbox')).toBeNull();
  expect(backToDefaultTab).not.toHaveBeenCalled();

  press('Escape');
  expect(backToDefaultTab).toHaveBeenCalledOnce();
});

it('collapses an empty field on Escape', () => {
  const { view, focusResults } = setup();

  fireEvent.click(view.getByRole('button', { name: 'Search tasks' }));
  const field = view.getByRole('searchbox', { name: 'Search tasks' });
  type(field, 'Escape');

  expect(view.queryByRole('searchbox')).toBeNull();
  expect(focusResults).toHaveBeenCalledOnce();
});

it('clears the search when a list has taken over the split Escape', () => {
  const { view, search, selected, list } = setup({
    search: 'budget',
    selected: 1,
    overridden: true,
  });
  list().focus();

  press('Escape');
  expect(selected()).toBe(0);
  expect(search()).toBe('budget');

  press('Escape');
  expect(search()).toBe('');
  expect(view.queryByRole('searchbox')).toBeNull();
});

it('returns focus to its button when no list takes the keyboard', async () => {
  const [search, setSearch] = createSignal('');
  const view = render(() => (
    <ListHeaderSearch
      label="Search passwords"
      value={search()}
      onValueChange={setSearch}
      registerFocus={() => {}}
    />
  ));

  fireEvent.click(view.getByRole('button', { name: 'Search passwords' }));
  await Promise.resolve();
  const field = view.getByRole('searchbox', { name: 'Search passwords' });
  expect(document.activeElement).toBe(field);
  type(field, 'ArrowDown');
  expect(document.activeElement).toBe(field);

  type(field, 'Escape');
  await Promise.resolve();
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Search passwords' })
  );
});

it('refocuses the field with its query through the registered focus', async () => {
  const [search, setSearch] = createSignal('budget');
  let focusSearch!: () => void;
  const view = render(() => (
    <ListHeaderSearch
      label="Search tasks"
      value={search()}
      onValueChange={setSearch}
      focusResults={() => {}}
      registerFocus={(focus) => {
        focusSearch = focus;
      }}
    />
  ));
  const field = view.getByRole('searchbox', { name: 'Search tasks' });
  field.focus();
  type(field, 'Escape');
  expect(document.activeElement).not.toBe(field);

  focusSearch();
  await Promise.resolve();
  expect(document.activeElement).toBe(field);
  expect(search()).toBe('budget');
});

it('keeps the keyboard in the field when the view has no list on screen', () => {
  const [search, setSearch] = createSignal('budget');
  const view = render(() => (
    <ListHeaderSearch
      label="Search routines"
      value={search()}
      onValueChange={setSearch}
      // The tab on screen has no list to focus.
      focusResults={() => {}}
      registerFocus={() => {}}
    />
  ));
  const field = view.getByRole('searchbox', { name: 'Search routines' });
  field.focus();

  type(field, 'ArrowDown');
  expect(document.activeElement).toBe(field);

  type(field, 'Escape');
  expect(document.activeElement).not.toBe(field);
  expect(search()).toBe('budget');
});

it('leaves an Escape that cancels a composition to the field', () => {
  const { field, search, focusResults } = setup({ search: 'budget' });

  field().focus();
  type(field(), 'Escape', { isComposing: true });

  expect(document.activeElement).toBe(field());
  expect(focusResults).not.toHaveBeenCalled();
  expect(search()).toBe('budget');
});
