import { Combobox } from '@kobalte/core/combobox';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchableMultiSelect } from '../../features/next-soup/soup-view/filters-bar/searchable-multi-select';
import { Dropdown } from '../ui/components/Dropdown';
import type { AiFilterOutcome } from './AiFilterInput';
import { ListFilterCountBadge, ListFilterDropdown } from './ListDropdowns';

// Exercise the actual menus/comboboxes without initializing the app UI barrel.
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/components/Dropdown')),
  ...(await import('../ui/components/Layer')),
}));
vi.mock('../ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
// jsdom has no viewport measurements. Keep the real Kobalte options and events.
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: unknown[];
    children: (item: unknown) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function setup(single = false, searchable = false, initial: string[] = []) {
  const [selected, setSelected] = createSignal<string[]>(initial);
  const [open, setOpen] = createSignal(true);
  render(() => (
    <ListFilterDropdown<'people' | 'scope', string>
      label="Filter tasks"
      activeCount={selected().length}
      open={open()}
      onOpenChange={setOpen}
      groups={[
        {
          id: 'people',
          label: 'Assignee',
          selectionMode: single ? 'single' : 'multiple',
          searchPlaceholder: searchable ? 'Search assignees...' : undefined,
          options: [
            { id: 'alice', label: 'Alice' },
            { id: 'bob', label: 'Bob' },
            { id: 'carol', label: 'Carol' },
            { id: 'disabled', label: 'Disabled', disabled: true },
          ],
        },
        {
          id: 'scope',
          label: 'Files',
          selectionMode: 'single',
          options: [{ id: 'all', label: 'All files' }],
        },
      ]}
      isSelected={(_, id) => selected().includes(id)}
      selectedIds={(group) => (group === 'people' ? selected() : [])}
      onSelectionChange={(_, id, checked) =>
        setSelected((ids) =>
          checked
            ? single
              ? [id]
              : [...ids, id]
            : ids.filter((value) => value !== id)
        )
      }
      onClear={() => setSelected([])}
    />
  ));
  return { selected, open, setOpen };
}

function selectOption(element: HTMLElement, shiftKey = false) {
  fireEvent(
    element,
    new MouseEvent('pointerup', { button: 0, bubbles: true, shiftKey })
  );
}

function pressOption(element: HTMLElement, shiftKey: boolean) {
  fireEvent(
    element,
    new MouseEvent('pointerdown', { button: 0, bubbles: true, shiftKey })
  );
  selectOption(element, shiftKey);
}

async function openSubmenu() {
  const trigger = await screen.findByRole('menuitem', { name: 'Assignee' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

it('toggles checkboxes without closing a multiselect submenu', async () => {
  const { selected, open } = setup();
  await openSubmenu();
  const alice = await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  selectOption(
    alice.querySelector<HTMLElement>('[data-multiselect-checkbox]')!
  );
  expect(selected()).toEqual(['alice']);
  expect(open()).toBe(true);
  const bob = screen.getByRole('menuitemcheckbox', { name: 'Bob' });
  selectOption(bob.querySelector<HTMLElement>('[data-multiselect-checkbox]')!);
  expect(selected()).toEqual(['alice', 'bob']);
  selectOption(
    alice.querySelector<HTMLElement>('[data-multiselect-checkbox]')!
  );
  expect(selected()).toEqual(['bob']);
  expect(open()).toBe(true);
  expect(screen.getByLabelText('Filter tasks').textContent).toBe('1');
});

it.each(['Alice', 'Bob'])(
  'adds a row without removing existing selections and closes (%s)',
  async (name) => {
    const { selected, open } = setup(false, false, ['alice']);
    await openSubmenu();
    selectOption(await screen.findByRole('menuitemcheckbox', { name }));
    expect(selected()).toEqual(name === 'Alice' ? ['alice'] : ['alice', 'bob']);
    await waitFor(() => expect(open()).toBe(false));
  }
);

it.each(['pointer', 'keyboard', 'Only'])(
  'selects only one option and stays open (%s)',
  async (input) => {
    const { selected, open } = setup(false, false, ['alice', 'carol']);
    await openSubmenu();
    const bob = await screen.findByRole('menuitemcheckbox', { name: 'Bob' });
    if (input === 'pointer') selectOption(bob, true);
    else if (input === 'keyboard')
      fireEvent.keyDown(bob, { key: 'Enter', shiftKey: true });
    else
      fireEvent.click(screen.getByRole('button', { name: 'Select only Bob' }));
    expect(selected()).toEqual(['bob']);
    expect(open()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select only Bob' }));
    expect(selected()).toEqual(['bob']);
    expect(open()).toBe(true);
    fireEvent.keyDown(screen.getByRole('menuitemcheckbox', { name: 'Alice' }), {
      key: ' ',
    });
    expect(selected()).toEqual(['bob', 'alice']);
    expect(open()).toBe(true);
    fireEvent.keyDown(bob, { key: 'Enter' });
    await waitFor(() => expect(open()).toBe(false));
    expect(selected()).toEqual(['bob', 'alice']);
  }
);

function clickSearchOption(element: HTMLElement, shiftKey: boolean) {
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    const event = new MouseEvent(type, {
      button: 0,
      bubbles: true,
      cancelable: true,
      shiftKey,
    });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(element, event);
  }
}

it('searchable checkboxes toggle while Shift-click and Only replace the selection without closing', async () => {
  const { selected, open } = setup(false, true);
  await openSubmenu();
  const alice = await screen.findByRole('option', { name: 'Alice' });
  clickSearchOption(
    alice.querySelector<HTMLElement>('[data-multiselect-checkbox]')!,
    false
  );
  await waitFor(() => expect(selected()).toEqual(['alice']));
  clickSearchOption(
    screen
      .getByRole('option', { name: 'Carol' })
      .querySelector<HTMLElement>('[data-multiselect-checkbox]')!,
    false
  );
  await waitFor(() => expect(selected()).toEqual(['alice', 'carol']));
  expect(open()).toBe(true);
  clickSearchOption(screen.getByRole('option', { name: 'Alice' }), true);
  await waitFor(() => expect(selected()).toEqual(['alice']));
  expect(open()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Select only Carol' }));
  expect(selected()).toEqual(['carol']);
  expect(open()).toBe(true);
  clickSearchOption(screen.getByRole('option', { name: 'Carol' }), false);
  await waitFor(() => expect(open()).toBe(false));
  expect(selected()).toEqual(['carol']);
});

it.each([false, true])(
  'Only leaves other groups unchanged (searchable: %s)',
  async (searchable) => {
    const [people, setPeople] = createSignal(['alice', 'bob']);
    const [status, setStatus] = createSignal(['open']);
    render(() => (
      <ListFilterDropdown
        open
        groups={[
          {
            id: 'people',
            label: 'Assignee',
            searchPlaceholder: searchable ? 'Search assignees...' : undefined,
            options: [
              { id: 'alice', label: 'Alice' },
              { id: 'bob', label: 'Bob' },
            ],
          },
          {
            id: 'status',
            label: 'Status',
            options: [{ id: 'open', label: 'Open' }],
          },
        ]}
        isSelected={(group, id) =>
          (group === 'people' ? people() : status()).includes(id)
        }
        onSelectionChange={(group, id, checked) => {
          const update = (ids: string[]) =>
            checked ? [...ids, id] : ids.filter((value) => value !== id);
          if (group === 'people') setPeople(update);
          else setStatus(update);
        }}
      />
    ));
    await openSubmenu();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Select only Bob' })
    );
    expect(people()).toEqual(['bob']);
    expect(status()).toEqual(['open']);
  }
);

it.each([false, true])(
  'disabled options cannot change selection (searchable: %s)',
  async (searchable) => {
    const { selected, open } = setup(false, searchable, ['alice']);
    await openSubmenu();
    const option = await screen.findByRole(
      searchable ? 'option' : 'menuitemcheckbox',
      { name: 'Disabled' }
    );
    if (searchable) clickSearchOption(option, true);
    else selectOption(option, true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select only Disabled' })
    );
    expect(selected()).toEqual(['alice']);
    expect(open()).toBe(true);
  }
);

it('Shift-clicking a searchable checkbox still toggles only that checkbox', async () => {
  const { selected, open } = setup(false, true, ['alice']);
  await openSubmenu();
  const carol = await screen.findByRole('option', { name: 'Carol' });
  clickSearchOption(
    carol.querySelector<HTMLElement>('[data-multiselect-checkbox]')!,
    true
  );
  expect(selected()).toEqual(['alice', 'carol']);
  expect(open()).toBe(true);
});

it('Enter closes the entire searchable filter menu after applying the selection', async () => {
  const { selected, open } = setup(false, true);
  await openSubmenu();
  const input = await screen.findByPlaceholderText('Search assignees...');
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: 'Alice' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(open()).toBe(false));
  expect(selected()).toEqual(['alice']);
});

it.each(['pointer', 'keyboard'])(
  'standalone searchable filters keep exclusive selection open and add on ordinary selection (%s)',
  async (method) => {
    const [selected, setSelected] = createSignal<string[]>([]);
    const [open, setOpen] = createSignal(true);
    render(() => (
      <SearchableMultiSelect
        options={() => [
          { id: 'alice', label: 'Alice' },
          { id: 'bob', label: 'Bob' },
        ]}
        activeIds={selected}
        onChange={setSelected}
        open={open}
        onOpenChange={setOpen}
      >
        <Combobox.Trigger>People</Combobox.Trigger>
      </SearchableMultiSelect>
    ));
    const input = await screen.findByPlaceholderText('Search...');
    if (method === 'keyboard') {
      input.focus();
      fireEvent.input(input, { target: { value: 'Alice' } });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    } else
      clickSearchOption(
        await screen.findByRole('option', { name: 'Alice' }),
        true
      );
    await waitFor(() => expect(selected()).toEqual(['alice']));
    expect(open()).toBe(true);
    if (method === 'keyboard') {
      // Choosing an option clears the search; highlight the next choice again.
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
    } else
      clickSearchOption(screen.getByRole('option', { name: 'Alice' }), false);
    await waitFor(() => expect(open()).toBe(false));
    expect(selected()).toEqual(['alice']);
  }
);

it.each([false, true])(
  'Only clears hidden group selections without ordinary toggles dropping them (searchable: %s)',
  async (searchable) => {
    const { selected, open } = setup(false, searchable, [
      'alice',
      'unavailable',
    ]);
    await openSubmenu();
    const bob = await screen.findByRole(
      searchable ? 'option' : 'menuitemcheckbox',
      { name: 'Bob' }
    );
    const checkbox = bob.querySelector<HTMLElement>(
      '[data-multiselect-checkbox]'
    )!;
    if (searchable) clickSearchOption(checkbox, false);
    else selectOption(checkbox);
    expect(selected()).toEqual(['alice', 'unavailable', 'bob']);
    fireEvent.click(screen.getByRole('button', { name: 'Select only Bob' }));
    expect(selected()).toEqual(['bob']);
    expect(open()).toBe(true);
  }
);

it('preserves selected IDs absent from the current searchable options until Only replaces the selection', async () => {
  const [selected, setSelected] = createSignal(['alice', 'unavailable']);
  render(() => (
    <SearchableMultiSelect
      options={() => [
        { id: 'alice', label: 'Alice' },
        { id: 'bob', label: 'Bob' },
      ]}
      activeIds={selected}
      onChange={setSelected}
      open={() => true}
    >
      <Combobox.Trigger>People</Combobox.Trigger>
    </SearchableMultiSelect>
  ));
  const alice = await screen.findByRole('option', { name: 'Alice' });
  clickSearchOption(
    alice.querySelector<HTMLElement>('[data-multiselect-checkbox]')!,
    false
  );
  expect(selected()).toEqual(['unavailable']);
  const bob = screen.getByRole('option', { name: 'Bob' });
  clickSearchOption(
    bob.querySelector<HTMLElement>('[data-multiselect-checkbox]')!,
    false
  );
  expect(selected()).toEqual(['unavailable', 'bob']);
  fireEvent.click(screen.getByRole('button', { name: 'Select only Bob' }));
  expect(selected()).toEqual(['bob']);
});

it('runs a searchable action once and closes without changing the selected options', async () => {
  const [selected, setSelected] = createSignal(['alice']);
  const [open, setOpen] = createSignal(true);
  const onSelect = vi.fn();
  render(() => (
    <SearchableMultiSelect
      options={() => [{ id: 'alice', label: 'Alice' }]}
      activeIds={selected}
      onChange={setSelected}
      open={open}
      onOpenChange={setOpen}
      action={{ label: 'Connect account', onSelect }}
    >
      <Combobox.Trigger>People</Combobox.Trigger>
    </SearchableMultiSelect>
  ));
  clickSearchOption(
    await screen.findByRole('option', { name: 'Connect account' }),
    true
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(open()).toBe(false);
  expect(selected()).toEqual(['alice']);
});

it('shared checkbox filters support Shift+Enter and close after ordinary Enter', async () => {
  const [checked, setChecked] = createSignal(false);
  const [open, setOpen] = createSignal(true);
  render(() => (
    <Dropdown open={open()} onOpenChange={setOpen}>
      <Dropdown.Trigger>Options</Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.CheckboxItem
          closeOnSelect="unless-shift"
          checked={checked()}
          onChange={setChecked}
        >
          Accepted
        </Dropdown.CheckboxItem>
      </Dropdown.Content>
    </Dropdown>
  ));
  const option = await screen.findByRole('menuitemcheckbox', {
    name: 'Accepted',
  });
  await waitFor(() => expect(document.activeElement).toBe(option));
  fireEvent.keyDown(option, { key: 'Enter', shiftKey: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(checked()).toBe(true);
  expect(open()).toBe(true);
  fireEvent.keyDown(option, { key: 'Enter' });
  await waitFor(() => expect(open()).toBe(false));
  expect(checked()).toBe(false);
});

function mousePointer(
  element: HTMLElement,
  type: string,
  at: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 }
) {
  const event = new MouseEvent(type, {
    // Like the browser, enter/leave do not bubble to the menu or document.
    bubbles: type !== 'pointerenter' && type !== 'pointerleave',
    cancelable: true,
    ...at,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(element, event);
}

function crossMenuPadding() {
  const trigger = screen.getByRole('menuitem', { name: 'Assignee' });
  mousePointer(trigger, 'pointerleave');
  // jsdom has no layout for Kobalte's grace polygon. Reproduce the background
  // focus it performs when the mouse leaves that polygon into menu padding.
  trigger.closest<HTMLElement>('[role="menu"]')!.focus();
}

/**
 * Opens Assignee, lays its submenu out to the left of the menu (where the
 * Tasks and Home menus open them at the window's right edge), and leaves the
 * Assignee row heading left, toward that submenu.
 */
async function leaveTowardAssigneeSubmenu(searchable: boolean) {
  setup(false, searchable);
  await openSubmenu();
  const submenuChild = searchable
    ? await screen.findByPlaceholderText('Search assignees...')
    : await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  const submenu = submenuChild.closest<HTMLElement>('[role="menu"]')!;
  // jsdom has no viewport, so the submenu flips to the left once positioned.
  await waitFor(() =>
    expect(
      submenu
        .closest<HTMLElement>('[data-popper-positioner]')!
        .style.getPropertyValue('--kb-popper-content-transform-origin')
    ).toMatch(/^right/)
  );
  if (searchable)
    await waitFor(() => expect(document.activeElement).toBe(submenuChild));
  vi.spyOn(submenu, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 200)
  );
  const assignee = screen.getByRole('menuitem', { name: 'Assignee' });
  const menu = assignee.closest<HTMLElement>('[role="menu"]')!;
  mousePointer(menu, 'pointermove', { clientX: 200, clientY: 20 });
  mousePointer(menu, 'pointermove', { clientX: 150, clientY: 20 });
  mousePointer(assignee, 'pointerleave', { clientX: 150, clientY: 20 });
  return { assignee, menu };
}

it.each([false, true])(
  'keeps the open submenu while the mouse crosses a sibling toward it, then switches once it rests there (searchable: %s)',
  async (searchable) => {
    const { assignee } = await leaveTowardAssigneeSubmenu(searchable);
    const files = screen.getByRole('menuitem', { name: 'Files' });
    mousePointer(files, 'pointerenter', { clientX: 140, clientY: 30 });
    mousePointer(files, 'pointermove', { clientX: 140, clientY: 30 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(assignee.getAttribute('aria-expanded')).toBe('true');
    expect(files.getAttribute('aria-expanded')).toBe('false');

    // Kobalte suppresses pointermove inside the old submenu's grace polygon,
    // so a mouse that stops on Files must still switch to it.
    await waitFor(() =>
      expect(files.getAttribute('aria-expanded')).toBe('true')
    );
    expect(assignee.getAttribute('aria-expanded')).toBe('false');
    expect(
      await screen.findByRole('menuitemradio', { name: 'All files' })
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search assignees...')).toBeNull();
  }
);

it('switches to a sibling straight away when the mouse moves away from the open submenu', async () => {
  const { assignee, menu } = await leaveTowardAssigneeSubmenu(false);
  const files = screen.getByRole('menuitem', { name: 'Files' });
  for (const clientX of [160, 170, 180])
    mousePointer(menu, 'pointermove', { clientX, clientY: 30 });
  mousePointer(files, 'pointerenter', { clientX: 190, clientY: 30 });
  mousePointer(files, 'pointermove', { clientX: 190, clientY: 30 });
  expect(assignee.getAttribute('aria-expanded')).toBe('false');
  await waitFor(() => expect(files.getAttribute('aria-expanded')).toBe('true'));
});

it.each([false, true])(
  'keeps following a slow mouse into the open submenu after Kobalte’s grace expires (searchable: %s)',
  async (searchable) => {
    const { assignee, menu } = await leaveTowardAssigneeSubmenu(searchable);
    // Kobalte drops its grace polygon 300 ms after the mouse leaves Assignee.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const files = screen.getByRole('menuitem', { name: 'Files' });
    mousePointer(menu, 'pointermove', { clientX: 145, clientY: 25 });
    mousePointer(files, 'pointerenter', { clientX: 140, clientY: 30 });
    mousePointer(files, 'pointermove', { clientX: 140, clientY: 30 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    mousePointer(files, 'pointermove', { clientX: 125, clientY: 35 });
    mousePointer(files, 'pointerleave', { clientX: 110, clientY: 40 });
    mousePointer(menu, 'pointermove', { clientX: 110, clientY: 40 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(files.getAttribute('aria-expanded')).toBe('false');
    expect(assignee.getAttribute('aria-expanded')).toBe('true');

    const submenu = document.getElementById(
      assignee.getAttribute('aria-controls')!
    )!;
    mousePointer(submenu, 'pointerenter', { clientX: 95, clientY: 45 });
    mousePointer(submenu, 'pointermove', { clientX: 95, clientY: 45 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(assignee.getAttribute('aria-expanded')).toBe('true');
  }
);

it('closes the open submenu once the mouse stops short of it', async () => {
  const { assignee, menu } = await leaveTowardAssigneeSubmenu(false);
  await new Promise((resolve) => setTimeout(resolve, 350));
  mousePointer(menu, 'pointermove', { clientX: 145, clientY: 25 });
  // Kobalte focuses the menu when the mouse leaves a row outside its grace.
  menu.focus();
  expect(assignee.getAttribute('aria-expanded')).toBe('true');
  await waitFor(() =>
    expect(assignee.getAttribute('aria-expanded')).toBe('false')
  );
});

it('keeps a submenu open while crossing padding, cancelling dismissal on entry', async () => {
  setup();
  await openSubmenu();
  const option = await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  const submenu = option.closest<HTMLElement>('[role="menu"]')!;

  crossMenuPadding();
  expect(option.isConnected).toBe(true);
  mousePointer(submenu, 'pointerenter');
  mousePointer(option, 'pointermove');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(option.isConnected).toBe(true);
  selectOption(option);
  expect(option.getAttribute('aria-checked')).toBe('true');
});

it('closes the submenu after lingering in the padding', async () => {
  setup();
  await openSubmenu();
  await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  crossMenuPadding();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Alice' })).toBeTruthy();
  await waitFor(() =>
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Alice' })).toBeNull()
  );
});

it('dismisses immediately with Escape during the pointer grace period', async () => {
  const { open } = setup();
  await openSubmenu();
  await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  crossMenuPadding();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(open()).toBe(false);
});

it('dismisses on an outside click during the pointer grace period', async () => {
  const { open } = setup();
  await openSubmenu();
  await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  // Outside-interaction listeners register on the next tick after mounting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  crossMenuPadding();
  mousePointer(document.body, 'pointerdown');
  expect(open()).toBe(false);
});

it('also preserves a searchable submenu when crossing the parent padding', async () => {
  setup(false, true);
  await openSubmenu();
  const input = await screen.findByPlaceholderText('Search assignees...');
  await waitFor(() => expect(document.activeElement).toBe(input));
  crossMenuPadding();
  expect(input.isConnected).toBe(true);
  mousePointer(input.closest<HTMLElement>('[role="menu"]')!, 'pointerenter');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
});

it('closes a single-select menu after choosing an option and retains it on reopen', async () => {
  const { selected, open, setOpen } = setup(true);
  await openSubmenu();
  selectOption(await screen.findByRole('menuitemradio', { name: 'Alice' }));
  expect(selected()).toEqual(['alice']);
  await waitFor(() => expect(open()).toBe(false));
  setOpen(true);
  await openSubmenu();
  expect(
    (await screen.findByRole('menuitemradio', { name: 'Alice' })).getAttribute(
      'aria-checked'
    )
  ).toBe('true');
  selectOption(screen.getByRole('menuitemradio', { name: 'Bob' }));
  expect(selected()).toEqual(['bob']);
  await waitFor(() => expect(open()).toBe(false));
});

it('focuses searchable submenus on opening and reopening and supports keyboard selection', async () => {
  const { selected, open, setOpen } = setup(false, true);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) setOpen(true);
    await openSubmenu();
    const input = await screen.findByPlaceholderText('Search assignees...');
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.input(input, { target: { value: attempt ? 'Bob' : 'Alice' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    await waitFor(() =>
      expect(selected()).toEqual(attempt ? ['bob'] : ['alice'])
    );
    expect(open()).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Search assignees...')).toBeNull()
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(open()).toBe(false));
  }
});

function setupAiFilter(onSubmit: (query: string) => Promise<AiFilterOutcome>) {
  const [open, setOpen] = createSignal(true);
  render(() => (
    <ListFilterDropdown
      label="Filter tasks"
      open={open()}
      onOpenChange={setOpen}
      groups={[
        {
          id: 'people',
          label: 'Assignee',
          options: [{ id: 'alice', label: 'Alice' }],
        },
      ]}
      isSelected={() => false}
      onSelectionChange={() => {}}
      aiFilter={{ placeholder: 'Filter with AI…', onSubmit }}
    />
  ));
  return { open };
}

it('focuses the AI input when the menu opens, with ArrowDown reaching the first row', async () => {
  setupAiFilter(async () => ({ status: 'applied' }) as const);
  const input = await screen.findByPlaceholderText('Filter with AI…');
  await waitFor(() => expect(document.activeElement).toBe(input));
  // Kobalte's deferred menu focus must not win afterwards.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(document.activeElement).toBe(input);

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('menuitem', { name: 'Assignee' })
    )
  );
});

it('submits the AI filter description on Enter and closes once it applies', async () => {
  const onSubmit = vi.fn(async () => ({ status: 'applied' }) as const);
  const { open } = setupAiFilter(onSubmit);
  const input = await screen.findByPlaceholderText('Filter with AI…');
  fireEvent.input(input, { target: { value: 'high priority only' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith('high priority only');
  await waitFor(() => expect(open()).toBe(false));
});

it('keeps the menu open with feedback when the request only partly maps', async () => {
  const { open } = setupAiFilter(async () => ({
    status: 'applied',
    note: 'Tags cannot be excluded.',
  }));
  const input = await screen.findByPlaceholderText('Filter with AI…');
  fireEvent.input(input, { target: { value: 'no dev tasks' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((await screen.findByRole('status')).textContent).toBe(
    'Tags cannot be excluded.'
  );
  expect(open()).toBe(true);
  expect((input as HTMLInputElement).value).toBe('');
});

it('shows an error and keeps the description when the request fails', async () => {
  const { open } = setupAiFilter(async () => ({
    status: 'error',
    message: 'AI filtering is unavailable right now.',
  }));
  const input = await screen.findByPlaceholderText('Filter with AI…');
  fireEvent.input(input, { target: { value: 'urgent tasks' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((await screen.findByRole('alert')).textContent).toBe(
    'AI filtering is unavailable right now.'
  );
  expect(open()).toBe(true);
  expect((input as HTMLInputElement).value).toBe('urgent tasks');
});

it('hands focus back to the AI input when a hovered row steals it mid-description', async () => {
  setupAiFilter(async () => ({ status: 'applied' }) as const);
  const input = await screen.findByPlaceholderText('Filter with AI…');
  const row = screen.getByRole('menuitem', { name: 'Assignee' });
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.input(input, { target: { value: 'urgent' } });
  expect(document.activeElement).toBe(input);

  // Kobalte focuses whichever row the mouse moves over.
  row.focus();
  await waitFor(() => expect(document.activeElement).toBe(input));

  // Keyboard navigation is a deliberate hand-off and must stick.
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  row.focus();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(row);
});

it('ignores Enter on an empty description and leaves the option rows reachable', async () => {
  const onSubmit = vi.fn(async () => ({ status: 'applied' }) as const);
  setupAiFilter(onSubmit);
  const input = await screen.findByPlaceholderText('Filter with AI…');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('menuitem', { name: 'Assignee' })).toBeTruthy();
});

it('keeps an option selectable when the group list is rebuilt mid-press', async () => {
  const [selected, setSelected] = createSignal<string[]>([]);
  const [revision, setRevision] = createSignal(0);
  const [open, setOpen] = createSignal(true);
  // Callers derive groups from queries and flags, so an unrelated settle can
  // hand the menu an equivalent-but-new array at any point in a press.
  const groups = () => {
    void revision();

    return [
      {
        id: 'people',
        label: 'Assignee',
        options: [
          { id: 'alice', label: 'Alice' },
          { id: 'bob', label: 'Bob' },
        ],
      },
    ];
  };
  render(() => (
    <ListFilterDropdown
      label="Filter tasks"
      open={open()}
      onOpenChange={setOpen}
      groups={groups()}
      isSelected={(_, id) => selected().includes(id)}
      onSelectionChange={(_, id, checked) =>
        setSelected((ids) =>
          checked ? [...ids, id] : ids.filter((value) => value !== id)
        )
      }
    />
  ));
  await openSubmenu();
  const option = await screen.findByRole('menuitemcheckbox', { name: 'Alice' });
  option.addEventListener('pointerdown', () => setRevision((n) => n + 1));

  pressOption(option, true);
  expect(selected()).toEqual(['alice']);
  expect(open()).toBe(true);
});

it('ties each group row to its id rather than its position', async () => {
  // Groups appear and disappear from the middle of the list, so a row reused
  // positionally would carry one group's open submenu over to another.
  const [withPriority, setWithPriority] = createSignal(false);
  const groups = () => [
    ...(withPriority()
      ? [
          {
            id: 'priority',
            label: 'Priority',
            options: [{ id: 'high', label: 'High' }],
          },
        ]
      : []),
    {
      id: 'people',
      label: 'Assignee',
      options: [{ id: 'alice', label: 'Alice' }],
    },
  ];
  render(() => (
    <ListFilterDropdown
      label="Filter tasks"
      open
      groups={groups()}
      isSelected={() => false}
      onSelectionChange={() => {}}
    />
  ));
  const assigneeRow = await screen.findByRole('menuitem', { name: 'Assignee' });

  setWithPriority(true);

  expect(screen.getByRole('menuitem', { name: 'Priority' })).toBeTruthy();
  expect(screen.getByRole('menuitem', { name: 'Assignee' })).toBe(assigneeRow);
});

it('shows the applied filter count only while filters are active', () => {
  const [count, setCount] = createSignal(0);
  const { container } = render(() => <ListFilterCountBadge count={count()} />);
  expect(container.textContent).toBe('');

  setCount(2);
  expect(container.textContent).toBe('2');

  setCount(0);
  expect(container.textContent).toBe('');
});
