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
import { HOTKEY_PRIORITY_HIGH } from '@core/hotkey/types';
import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ListHeaderSearch, type ListSearchResultsRow } from './ListHeader';

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

function setup(options: { search?: string; selected?: number } = {}) {
  const [search, setSearch] = createSignal(options.search ?? '');
  const [selected, setSelected] = createSignal(options.selected ?? 0);
  const focusedRows: ListSearchResultsRow[] = [];
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
          focusResults={(row) => {
            focusedRows.push(row);
            list.focus();
          }}
          registerFocus={() => {}}
        />
      </SplitPanelContext.Provider>
    );
  }

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('tasks-split');
    // The list's own Escape steps, as use-list-interactions and a view
    // register them: clear a selection first, leave the view last.
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
    focusedRows,
    backToDefaultTab,
    list: () => list,
  };
}

it('moves from the field to the first result on ArrowDown and on Enter', () => {
  const { field, search, focusedRows, list } = setup({ search: 'budget' });

  field().focus();
  type(field(), 'ArrowDown');
  expect(focusedRows).toEqual(['first']);
  expect(document.activeElement).toBe(list());

  field().focus();
  type(field(), 'Enter');
  expect(focusedRows).toEqual(['first', 'first']);
  expect(search()).toBe('budget');
});

it('leaves modified and composing keys to the field', () => {
  const { field, focusedRows } = setup({ search: 'budget' });

  field().focus();
  type(field(), 'Enter', { isComposing: true });
  type(field(), 'ArrowDown', { shiftKey: true });
  expect(focusedRows).toEqual([]);
  expect(document.activeElement).toBe(field());
});

it('keeps the search when Escape leaves the field', () => {
  const { view, field, search, focusedRows, list } = setup({
    search: 'budget',
  });

  field().focus();
  type(field(), 'Escape');

  expect(search()).toBe('budget');
  expect(focusedRows).toEqual(['current']);
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
  const { view, focusedRows } = setup();

  fireEvent.click(view.getByRole('button', { name: 'Search tasks' }));
  const field = view.getByRole('searchbox', { name: 'Search tasks' });
  type(field, 'Escape');

  expect(view.queryByRole('searchbox')).toBeNull();
  expect(focusedRows).toEqual(['current']);
});
