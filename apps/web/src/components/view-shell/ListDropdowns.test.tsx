import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListFilterDropdown } from './ListDropdowns';

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

function setup(single = false, searchable = false) {
  const [selected, setSelected] = createSignal<string[]>([]);
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
          selectionMode: single ? 'single' : 'multiple',
          searchPlaceholder: searchable ? 'Search assignees...' : undefined,
          options: [
            { id: 'alice', label: 'Alice' },
            { id: 'bob', label: 'Bob' },
          ],
        },
      ]}
      isSelected={(_, id) => selected().includes(id)}
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

function selectOption(element: HTMLElement) {
  fireEvent(element, new MouseEvent('pointerup', { button: 0, bubbles: true }));
}

async function openSubmenu() {
  const trigger = await screen.findByRole('menuitem', { name: 'Assignee' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
}

it('keeps multi-select menus open while adding and removing filters', async () => {
  const { selected, open } = setup();
  await openSubmenu();
  selectOption(await screen.findByRole('menuitemcheckbox', { name: 'Alice' }));
  expect(selected()).toEqual(['alice']);
  expect(open()).toBe(true);
  expect(
    screen
      .getByRole('menuitemcheckbox', { name: 'Alice' })
      .getAttribute('aria-checked')
  ).toBe('true');
  selectOption(screen.getByRole('menuitemcheckbox', { name: 'Bob' }));
  expect(selected()).toEqual(['alice', 'bob']);
  selectOption(screen.getByRole('menuitemcheckbox', { name: 'Alice' }));
  expect(selected()).toEqual(['bob']);
  expect(open()).toBe(true);
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
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(selected()).toEqual(attempt ? ['alice', 'bob'] : ['alice'])
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
