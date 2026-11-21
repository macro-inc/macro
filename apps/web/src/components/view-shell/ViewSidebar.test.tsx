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
import { ViewSidebar } from './ViewSidebar';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

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
    /** The sidebar keeps its search open itself, as Chat does. */
    controlled?: boolean;
    withoutList?: boolean;
    /** The search found nothing, so the list has no first row. */
    empty?: boolean;
    /** What the sidebar says of its own rows, apart from the split's list. */
    hasResults?: boolean;
  } = {}
) {
  const [search, setSearch] = createSignal(options.search ?? '');
  const [open, setOpen] = createSignal(Boolean(options.search));
  const [selected, setSelected] = createSignal(options.selected ?? 0);
  const focusResults = vi.fn();
  const goToFirst = vi.fn(() => !options.empty);
  const leaveView = vi.fn(() => true);
  let list!: HTMLDivElement;
  let detail!: HTMLDivElement;

  function Sidebar(props: { scopeId: string }) {
    return (
      <SplitPanelContext.Provider
        value={
          {
            isPanelActive: () => true,
            splitHotkeyScope: props.scopeId,
          } as unknown as SplitPanelContextType
        }
      >
        <ViewSidebar.Header
          searchLabel="Search Home"
          searchOpen={options.controlled ? open() : undefined}
          onSearchOpenChange={(next) => {
            setOpen(next);
            if (options.controlled && !next) setSearch('');
          }}
          collapseControl={<span />}
          search={() => (
            <ViewSidebar.Search
              label="Search Home"
              value={search()}
              onValueChange={setSearch}
              hasResults={
                options.hasResults === undefined
                  ? undefined
                  : () => options.hasResults ?? true
              }
              focusResults={
                options.withoutList
                  ? undefined
                  : () => {
                      focusResults();
                      list.focus();
                    }
              }
            />
          )}
        >
          Home
        </ViewSidebar.Header>
      </SplitPanelContext.Provider>
    );
  }

  function Harness() {
    useHotKeyRoot();
    const [attachSplit, splitScope] = useHotkeyDOMScope('home-split');
    // The list's own keys, as use-list-interactions registers them: jump to
    // the first row, and clear a selection before anything else.
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
      description: 'Clear selection',
      condition: () => selected() > 0,
      keyDownHandler: () => {
        setSelected(0);
        return true;
      },
      registrationType: 'add',
      handlerPriority: HOTKEY_PRIORITY_HIGH,
    });
    registerHotkey({
      hotkey: 'escape',
      scopeId: splitScope,
      description: 'Leave the view',
      condition: () => selected() === 0 && !search().trim(),
      keyDownHandler: leaveView,
      registrationType: 'add',
    });

    // The split holds the sidebar (its search and list) and, beside it, the
    // detail the list opened.
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachSplit}>
          <div data-view-shell-aside="">
            <Sidebar scopeId={splitScope} />
            <div ref={list} tabIndex={0} />
          </div>
          <div ref={detail} tabIndex={0} />
        </div>
      </div>
    );
  }

  const view = render(() => <Harness />);
  const button = () => view.getByRole('button', { name: 'Search Home' });
  const field = () => view.getByRole('searchbox', { name: 'Search Home' });
  const openField = async () => {
    fireEvent.click(button());
    await Promise.resolve();
    return field();
  };
  return {
    view,
    button,
    field,
    openField,
    search,
    open,
    selected,
    focusResults,
    goToFirst,
    leaveView,
    list: () => list,
    detail: () => detail,
  };
}

it('moves from the field to the first result on ArrowDown and on Enter', async () => {
  const { openField, search, goToFirst, list } = setup();
  const field = await openField();
  fireEvent.input(field, { target: { value: 'hello' } });
  expect(search()).toBe('hello');

  field.focus();
  type(field, 'ArrowDown');
  expect(document.activeElement).toBe(list());
  expect(goToFirst).toHaveBeenCalledTimes(1);

  field.focus();
  type(field, 'Enter');
  expect(document.activeElement).toBe(list());
  expect(goToFirst).toHaveBeenCalledTimes(2);
  expect(search()).toBe('hello');
});

it('keeps ArrowDown and Enter in the field when the search found nothing', async () => {
  const { openField, search, focusResults } = setup({
    search: 'zzz',
    empty: true,
  });
  const field = await openField();

  field.focus();
  type(field, 'ArrowDown');
  type(field, 'Enter');

  expect(document.activeElement).toBe(field);
  expect(focusResults).not.toHaveBeenCalled();
  expect(search()).toBe('zzz');
});

it('trusts its own rows over another list in the split', async () => {
  // Another list in the split answers "go to first item" with its own rows.
  const withoutRows = setup({ search: 'zzz', hasResults: false });
  const field = await withoutRows.openField();
  field.focus();
  type(field, 'Enter');
  expect(document.activeElement).toBe(field);
  withoutRows.view.unmount();

  // That other list is empty, but the sidebar's own results are not.
  const withRows = setup({ search: 'gab', empty: true, hasResults: true });
  const other = await withRows.openField();
  other.focus();
  type(other, 'Enter');
  expect(document.activeElement).toBe(withRows.list());
});

it('turns off the browser history popup that would take the arrow keys', async () => {
  const { openField } = setup();

  expect((await openField()).getAttribute('autocomplete')).toBe('off');
});

it('leaves modified and composing keys to the field', async () => {
  const { openField, focusResults } = setup({ search: 'hello' });
  const field = await openField();

  field.focus();
  type(field, 'Enter', { isComposing: true });
  type(field, 'ArrowDown', { shiftKey: true });
  expect(focusResults).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field);
});

it('keeps the search when Escape leaves the field for the list', async () => {
  const { openField, field, search, goToFirst, list } = setup({
    search: 'hello',
  });
  (await openField()).focus();

  type(field(), 'Escape');

  expect(search()).toBe('hello');
  // The list keeps the row it was on.
  expect(goToFirst).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(list());
  expect(field()).toBeTruthy();
});

it('clears the search on Escape in the list, after a selection, then collapses the field', async () => {
  const { view, openField, search, selected, leaveView, list } = setup({
    search: 'hello',
    selected: 2,
  });
  await openField();
  list().focus();

  press('Escape');
  expect(selected()).toBe(0);
  expect(search()).toBe('hello');

  press('Escape');
  expect(search()).toBe('');
  expect(view.queryByRole('searchbox')).toBeNull();
  expect(leaveView).not.toHaveBeenCalled();

  press('Escape');
  expect(leaveView).toHaveBeenCalledOnce();
});

it('leaves an Escape pressed in the detail beside the sidebar alone', async () => {
  const { openField, field, search, leaveView, detail } = setup({
    search: 'hello',
  });
  await openField();
  detail().focus();

  press('Escape');
  expect(search()).toBe('hello');
  expect(field()).toBeTruthy();
  expect(leaveView).not.toHaveBeenCalled();
});

it('closes a search the sidebar keeps open itself', async () => {
  const { view, field, search, open, list } = setup({
    search: 'gab',
    controlled: true,
  });
  expect(field()).toBeTruthy();
  list().focus();

  press('Escape');
  expect(open()).toBe(false);
  expect(search()).toBe('');
  expect(view.queryByRole('searchbox')).toBeNull();
});

it('collapses an empty field on Escape into the list', async () => {
  const { view, openField, focusResults, list } = setup();
  const field = await openField();

  type(field, 'Escape');

  expect(view.queryByRole('searchbox')).toBeNull();
  expect(focusResults).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(list());
});

it('returns an empty field to the search button when no list takes the keyboard', async () => {
  const { view, openField, button } = setup({ withoutList: true });
  const field = await openField();
  expect(document.activeElement).toBe(field);

  type(field, 'ArrowDown');
  expect(document.activeElement).toBe(field);

  type(field, 'Escape');
  await Promise.resolve();
  expect(view.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(button());
});

it('leaves an Escape that cancels a composition to the field', async () => {
  const { openField, search, focusResults } = setup({ search: 'hello' });
  const field = await openField();

  field.focus();
  type(field, 'Escape', { isComposing: true });

  expect(document.activeElement).toBe(field);
  expect(focusResults).not.toHaveBeenCalled();
  expect(search()).toBe('hello');
});
