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
import { createSignal, Show } from 'solid-js';
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
  options: {
    search?: string;
    selected?: number;
    overridden?: boolean;
    /** The search found nothing, so the list has no first row. */
    empty?: boolean;
    recent?: string[];
    /** The view keeps the field's open state, as Email does. */
    controlled?: boolean;
  } = {}
) {
  const [search, setSearch] = createSignal(options.search ?? '');
  const [open, setOpen] = createSignal(false);
  const [selected, setSelected] = createSignal(options.selected ?? 0);
  const [active, setActive] = createSignal(-1);
  const focusResults = vi.fn();
  const goToFirst = vi.fn(() => !options.empty);
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
          open={options.controlled ? open() : undefined}
          onOpenChange={setOpen}
          suggestions={
            options.recent
              ? {
                  count: () => options.recent?.length ?? 0,
                  active,
                  setActive,
                  pick: (index) => setSearch(options.recent?.[index] ?? ''),
                }
              : undefined
          }
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
      condition: () =>
        selected() === 0 && !search().trim() && !(options.controlled && open()),
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
    open,
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

it('keeps ArrowDown and Enter in the field when the search found nothing', () => {
  const { field, search, focusResults, goToFirst } = setup({
    search: 'zzz',
    empty: true,
  });

  field().focus();
  type(field(), 'ArrowDown');
  expect(document.activeElement).toBe(field());

  type(field(), 'Enter');
  expect(document.activeElement).toBe(field());
  expect(goToFirst).toHaveBeenCalledTimes(2);
  expect(focusResults).not.toHaveBeenCalled();
  expect(search()).toBe('zzz');
});

it('stays in the field past the last suggestion when the search found nothing', () => {
  const { field } = setup({ search: 'bu', empty: true, recent: ['budget'] });

  field().focus();
  type(field(), 'ArrowDown');
  type(field(), 'ArrowDown');

  expect(document.activeElement).toBe(field());
});

it('moves to the list for a picked suggestion before its rows arrive', () => {
  const { field, search, list } = setup({
    search: 'bu',
    empty: true,
    recent: ['budget'],
  });

  field().focus();
  type(field(), 'ArrowDown');
  type(field(), 'Enter');

  expect(search()).toBe('budget');
  expect(document.activeElement).toBe(list());
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

it('closes a field its view keeps open on Escape in the list, before leaving the tab', () => {
  const { view, open, backToDefaultTab, list } = setup({ controlled: true });
  fireEvent.click(view.getByRole('button', { name: 'Search tasks' }));
  list().focus();
  expect(open()).toBe(true);

  press('Escape');
  expect(open()).toBe(false);
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

it('keeps an empty field open when the view has no list on screen', async () => {
  const [search, setSearch] = createSignal('');
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
  fireEvent.click(view.getByRole('button', { name: 'Search routines' }));
  await Promise.resolve();
  const field = view.getByRole('searchbox', { name: 'Search routines' });

  type(field, 'ArrowDown');
  type(field, 'Enter');
  expect(document.activeElement).toBe(field);

  type(field, 'Escape');
  await Promise.resolve();
  expect(view.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Search routines' })
  );
});

function setupSuggestions(initial: string[]) {
  const [search, setSearch] = createSignal('bu');
  const [active, setActive] = createSignal(-1);
  const [open, setOpen] = createSignal(false);
  const picked: number[] = [];
  let list!: HTMLDivElement;

  const view = render(() => (
    <div>
      <ListHeaderSearch
        label="Search email"
        value={search()}
        onValueChange={setSearch}
        focusResults={() => list.focus()}
        registerFocus={() => {}}
        wide
        onOpenChange={setOpen}
        suggestions={{
          count: () => initial.length,
          active,
          setActive,
          pick: (index) => {
            picked.push(index);
            setSearch(initial[index] ?? '');
          },
        }}
      />
      <div ref={list} tabIndex={0} />
    </div>
  ));
  const field = view.getByRole('searchbox', { name: 'Search email' });
  field.focus();
  return {
    view,
    field,
    search,
    setSearch,
    active,
    open,
    picked,
    list: () => list,
  };
}

it('walks suggestions with the arrows before it reaches the results', () => {
  const { field, active, list } = setupSuggestions(['budget', 'build']);

  type(field, 'ArrowDown');
  type(field, 'ArrowDown');
  expect(active()).toBe(1);
  expect(document.activeElement).toBe(field);

  type(field, 'ArrowUp');
  type(field, 'ArrowUp');
  expect(active()).toBe(-1);

  type(field, 'ArrowDown');
  type(field, 'ArrowDown');
  type(field, 'ArrowDown');
  expect(document.activeElement).toBe(list());
});

it('runs the active suggestion on Enter and moves to its results', () => {
  const { field, search, picked, list } = setupSuggestions(['budget']);

  type(field, 'ArrowDown');
  type(field, 'Enter');

  expect(picked).toEqual([0]);
  expect(search()).toBe('budget');
  expect(document.activeElement).toBe(list());
});

it('reports a wide field open, and closed once it is left empty', () => {
  const { view, field, setSearch, open } = setupSuggestions([]);
  expect(open()).toBe(true);

  setSearch('');
  fireEvent.blur(field);

  expect(open()).toBe(false);
  expect(view.queryByRole('searchbox')).toBeNull();
});

it('closes a wide field when the view clears its search from outside', () => {
  const { view, field, setSearch, open } = setupSuggestions([]);
  field.blur();
  expect(open()).toBe(true);

  // A tab change clears the search while the field is not focused.
  setSearch('');

  expect(open()).toBe(false);
  expect(view.queryByRole('searchbox')).toBeNull();
});

it('reports closed and unfocused when it unmounts while open', () => {
  const [shown, setShown] = createSignal(true);
  const [open, setOpen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const view = render(() => (
    <Show when={shown()}>
      <ListHeaderSearch
        label="Search email"
        value="budget"
        onValueChange={() => {}}
        registerFocus={() => {}}
        wide
        onOpenChange={setOpen}
        onFocusChange={setFocused}
      />
    </Show>
  ));
  view.getByRole('searchbox', { name: 'Search email' }).focus();
  expect(open()).toBe(true);
  expect(focused()).toBe(true);

  setShown(false);

  expect(open()).toBe(false);
  expect(focused()).toBe(false);
});

it('closes for a view that keeps its open state, and reports it unfocused', () => {
  const [open, setOpen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const view = render(() => (
    <ListHeaderSearch
      label="Search email"
      value=""
      onValueChange={() => {}}
      registerFocus={() => {}}
      open={open()}
      onOpenChange={setOpen}
      onFocusChange={setFocused}
    />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Search email' }));
  view.getByRole('searchbox', { name: 'Search email' }).focus();
  expect(open()).toBe(true);
  expect(focused()).toBe(true);

  setOpen(false);

  expect(view.queryByRole('searchbox')).toBeNull();
  expect(focused()).toBe(false);

  fireEvent.click(view.getByRole('button', { name: 'Search email' }));
  expect(open()).toBe(true);
});
