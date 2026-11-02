import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListViewMenu } from '../../../components/view-shell/ListViewMenu';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  type TaskPropertyDisplay,
} from '../core/task-property-display';
import { TaskPropertyMenu } from './TaskPropertyMenu';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('../../../components/ui/components/Button')),
  ...(await import('../../../components/ui/components/ButtonGroup')),
  ...(await import('../../../components/ui/components/Dropdown')),
}));

beforeEach(() => {
  device.touch = false;
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
  vi.unstubAllGlobals();
});

it('changes a property mode by keyboard without closing View', async () => {
  const [display, setDisplay] = createSignal<TaskPropertyDisplay>({
    ...DEFAULT_TASK_PROPERTY_DISPLAY,
  });
  const [open, setOpen] = createSignal(true);
  render(() => (
    <HeaderActionGroup label="View options">
      <ListViewMenu open={open()} onOpenChange={setOpen}>
        <TaskPropertyMenu
          display={display()}
          showProject
          onChange={(property, mode) => {
            if (property === 'dueDate')
              setDisplay((current) => ({ ...current, dueDate: mode }));
          }}
        />
      </ListViewMenu>
    </HeaderActionGroup>
  ));
  const dueDate = screen.getByRole('menuitem', { name: /Due date/ });
  dueDate.focus();
  fireEvent.keyDown(dueDate, { key: 'ArrowRight' });
  const empty = await screen.findByRole('menuitemradio', {
    name: 'Hide when empty',
  });
  fireEvent.keyDown(empty, { key: 'Enter' });
  expect(display().dueDate).toBe('hide_when_empty');
  expect(open()).toBe(true);
  expect(
    screen
      .getByRole('menuitemradio', { name: 'Hide when empty' })
      .getAttribute('aria-checked')
  ).toBe('true');
});

it('changes phone property modes inside the existing View sheet', async () => {
  device.touch = true;
  const [display, setDisplay] = createSignal<TaskPropertyDisplay>({
    ...DEFAULT_TASK_PROPERTY_DISPLAY,
  });
  const [open, setOpen] = createSignal(false);
  render(() => (
    <ListViewMenu open={open()} onOpenChange={setOpen}>
      <TaskPropertyMenu
        display={display()}
        showProject
        onChange={(property, mode) => {
          if (property === 'dueDate')
            setDisplay((current) => ({ ...current, dueDate: mode }));
        }}
      />
    </ListViewMenu>
  ));
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  fireEvent.click(await screen.findByRole('button', { name: /Due date/ }));
  fireEvent.click(screen.getByRole('radio', { name: 'Hide when empty' }));
  expect(display().dueDate).toBe('hide_when_empty');
  expect(open()).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Hide' }));
  expect(display().dueDate).toBe('hide');
  fireEvent.keyDown(screen.getByRole('radio', { name: 'Hide' }), {
    key: 'Escape',
  });
  await waitFor(() => expect(open()).toBe(false));
});
