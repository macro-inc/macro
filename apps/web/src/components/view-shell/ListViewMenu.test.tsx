import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
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
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  device.touch = false;
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
  const [layout, setLayout] = createSignal<'list' | 'board'>('list');
  const [group, setGroup] = createSignal('priority');
  const [open, setOpen] = createSignal(true);
  render(() => (
    <HeaderActionGroup label="View options">
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

  fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Board' }), {
    key: 'Enter',
  });
  expect(layout()).toBe('board');
  expect(open()).toBe(true);
  const groupTrigger = screen.getByRole('menuitem', { name: /Group by/ });
  groupTrigger.focus();
  fireEvent.keyDown(groupTrigger, { key: 'ArrowRight' });
  const status = await screen.findByRole('menuitemradio', { name: 'Status' });
  fireEvent.keyDown(status, { key: 'Enter' });
  expect(group()).toBe('status');
  expect(layout()).toBe('board');
  expect(open()).toBe(true);
  fireEvent.keyDown(status, { key: 'Escape' });
  fireEvent.keyDown(groupTrigger, { key: 'Escape' });
  await waitFor(() => expect(open()).toBe(false));
});

it('keeps search ordering authoritative while other settings remain available', () => {
  const changeSort = vi.fn();
  render(() => (
    <HeaderActionGroup label="View options">
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
  const sort = screen.getByRole('menuitem', { name: /Sort/ });
  fireEvent.keyDown(sort, { key: 'Enter' });
  fireEvent.click(sort);
  expect(changeSort).not.toHaveBeenCalled();
  expect(sort.getAttribute('aria-disabled')).toBe('true');
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

  const trigger = screen.getByRole('button', { name: 'View options' });
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
