import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HeaderActionGroup } from '../app/HeaderActionGroup';
import { ListViewMenu } from './ListViewMenu';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('../ui/components/Button')),
  ...(await import('../ui/components/ButtonGroup')),
  ...(await import('../ui/components/Dropdown')),
  ...(await import('../ui/components/Tabs')),
  ...(await import('../ui/components/Popover')),
  ...(await import('../ui/components/Select')),
  ...(await import('../ui/components/Tooltip')),
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  device.touch = false;
  vi.stubGlobal('CSS', { escape: (value: string) => value });
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

it('applies layout and grouping from one menu without closing it', async () => {
  const user = userEvent.setup();
  const [layout, setLayout] = createSignal<'list' | 'board'>('list');
  const [group, setGroup] = createSignal('priority');
  const [open, setOpen] = createSignal(true);
  render(() => (
    <HeaderActionGroup label="Display options">
      <ListViewMenu
        open={open()}
        onOpenChange={setOpen}
        layout={{
          value: layout(),
          options: [
            { id: 'list', label: 'List' },
            { id: 'board', label: 'Board' },
          ],
          onChange: (value) => {
            if (value === 'list' || value === 'board') setLayout(value);
          },
        }}
        group={{
          value: group(),
          options: [
            { id: 'priority', label: 'Priority' },
            { id: 'status', label: 'Status' },
          ],
          onChange: setGroup,
        }}
      />
    </HeaderActionGroup>
  ));

  const list = screen.getByRole('radio', { name: 'List' });
  await waitFor(() => expect(document.activeElement).toBe(list));
  await user.keyboard('{ArrowRight}');
  expect(layout()).toBe('board');
  expect(open()).toBe(true);
  const groupTrigger = screen.getByRole('button', { name: /^Group by/ });
  await user.tab();
  expect(document.activeElement).toBe(groupTrigger);
  await user.keyboard('{ArrowDown}');
  const status = await screen.findByRole('option', { name: 'Status' });
  await user.click(status);
  expect(group()).toBe('status');
  expect(layout()).toBe('board');
  expect(open()).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(groupTrigger));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(open()).toBe(false));
});

it('keeps search ordering authoritative while other settings remain available', () => {
  const changeSort = vi.fn();
  render(() => (
    <HeaderActionGroup label="Display options">
      <ListViewMenu
        open
        sort={{
          value: 'updated',
          options: [{ id: 'updated', label: 'Updated' }],
          onChange: changeSort,
          disabledReason: 'Search controls ordering.',
        }}
      />
    </HeaderActionGroup>
  ));
  const sort = screen.getByRole('button', { name: 'Sort' });
  fireEvent.keyDown(sort, { key: 'Enter' });
  fireEvent.click(sort);
  expect(changeSort).not.toHaveBeenCalled();
  expect(sort.hasAttribute('disabled')).toBe(true);
});

it('applies mobile group and sort changes in a sheet and restores focus on dismiss', async () => {
  device.touch = true;
  const [group, setGroup] = createSignal('priority');
  const [sort, setSort] = createSignal('updated');
  const [open, setOpen] = createSignal(false);
  render(() => (
    <ListViewMenu
      open={open()}
      onOpenChange={setOpen}
      group={{
        value: group(),
        options: [
          { id: 'priority', label: 'Priority' },
          { id: 'status', label: 'Status' },
        ],
        onChange: setGroup,
      }}
      sort={{
        value: sort(),
        options: [
          { id: 'updated', label: 'Updated' },
          { id: 'created', label: 'Created' },
        ],
        onChange: setSort,
      }}
    />
  ));

  const trigger = screen.getByRole('button', { name: 'Display options' });
  fireEvent.click(trigger);
  const status = await screen.findByRole('radio', { name: 'Status' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  );
  fireEvent.click(status);
  fireEvent.click(screen.getByRole('radio', { name: 'Created' }));
  expect(group()).toBe('status');
  expect(sort()).toBe('created');
  expect(open()).toBe(true);
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Status' }), {
    key: 'Escape',
  });
  await waitFor(() => expect(open()).toBe(false));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
