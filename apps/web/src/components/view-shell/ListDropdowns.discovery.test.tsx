import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, For, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListFilterDropdown } from './ListDropdowns';

vi.mock('@ui', async () => ({
  ...(await import('../ui/components/Button')),
  ...(await import('../ui/components/ButtonGroup')),
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/components/Dropdown')),
  ...(await import('../ui/components/Layer')),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('virtua/solid', () => ({
  Virtualizer: (props: {
    data: unknown[];
    children: (item: unknown) => JSX.Element;
  }) => <For each={props.data}>{props.children}</For>,
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['keyboard', 'pointer'])(
  'discovers from a search with no matches without selecting the action (%s)',
  async (inputMode) => {
    const [discovering, setDiscovering] = createSignal(false);
    const [open, setOpen] = createSignal(true);
    const onChange = vi.fn();
    render(() => (
      <ListFilterDropdown
        open={open()}
        onOpenChange={setOpen}
        groups={[
          {
            id: 'assignees',
            label: 'Assignee',
            searchPlaceholder: 'Search assignees',
            options: [
              { id: 'team', label: 'Team member' },
              ...(discovering() ? [{ id: 'outside', label: 'Outside' }] : []),
            ],
            action: {
              label: discovering()
                ? 'Back to team members'
                : 'Find other people…',
              onSelect: () => setDiscovering((value) => !value),
              closeOnSelect: false,
            },
          },
        ]}
        isSelected={(_, id) => id === 'team'}
        selectedIds={() => ['team']}
        onSelectionChange={onChange}
      />
    ));
    const trigger = await screen.findByRole('menuitem', { name: 'Assignee' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const search = await screen.findByPlaceholderText('Search assignees');
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.input(search, { target: { value: 'outside' } });
    const action = await screen.findByRole('option', {
      name: 'Find other people…',
    });
    expect(screen.queryByRole('option', { name: 'Outside' })).toBeNull();
    if (inputMode === 'keyboard') {
      fireEvent.keyDown(search, { key: 'ArrowDown' });
      fireEvent.keyDown(search, { key: 'Enter' });
    } else {
      fireEvent.click(action);
    }
    expect(await screen.findByRole('option', { name: 'Outside' })).toBeTruthy();
    expect(
      await screen.findByRole('option', { name: 'Back to team members' })
    ).toBeTruthy();
    expect(open()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Search assignees')).toBe(search);
  }
);
