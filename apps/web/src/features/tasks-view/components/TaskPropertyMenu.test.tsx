import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
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
import { ListViewMenu } from '../../../components/view-shell/ListViewMenu';
import {
  DEFAULT_TASK_PROPERTY_DISPLAY,
  type TaskPropertyDisplay,
  taskPropertyDisplaySchema,
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

it('cycles supported pill modes and keeps direct keyboard choices in View', async () => {
  const user = userEvent.setup();
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
          onChange={(property, mode) =>
            setDisplay((current) =>
              taskPropertyDisplaySchema.parse({ ...current, [property]: mode })
            )
          }
        />
      </ListViewMenu>
    </HeaderActionGroup>
  ));
  const dueDate = screen.getByRole('menuitem', { name: /^Due date:/ });
  await user.click(dueDate);
  expect(display().dueDate).toBe('hide_when_empty');
  await user.click(dueDate);
  expect(display().dueDate).toBe('hide');
  dueDate.focus();
  fireEvent.keyDown(dueDate, { key: 'Enter' });
  expect(display().dueDate).toBe('show');

  const tags = screen.getByRole('menuitem', { name: /^Tags:/ });
  await user.click(tags);
  expect(display().tags).toBe('hide');
  await user.click(tags);
  expect(display().tags).toBe('show');

  dueDate.focus();
  fireEvent.keyDown(dueDate, { key: 'ArrowDown' });
  const trigger = screen.getByRole('menuitem', {
    name: 'Change Due date visibility',
  });
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const empty = await screen.findByRole('menuitemradio', {
    name: 'Hide when empty',
  });
  fireEvent.keyDown(empty, { key: 'Enter' });
  expect(display().dueDate).toBe('hide_when_empty');
  expect(open()).toBe(true);
  expect(empty.getAttribute('aria-checked')).toBe('true');
});

it('keeps View open while touch pills and their visibility sheet change modes', async () => {
  const user = userEvent.setup();
  device.touch = true;
  const [display, setDisplay] = createSignal<TaskPropertyDisplay>({
    ...DEFAULT_TASK_PROPERTY_DISPLAY,
  });
  const [open, setOpen] = createSignal(false);
  render(() => (
    <>
      {/* jsdom has no app CSS; disable exit motion to release closed layers. */}
      <style>{`
        [data-corvu-drawer-content], [data-corvu-drawer-overlay] {
          animation-name: none;
          transition-duration: 0s;
        }
      `}</style>
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
    </>
  ));
  await user.click(screen.getByRole('button', { name: 'View options' }));
  const dueDate = await screen.findByRole('button', { name: /^Due date:/ });
  await user.pointer({ keys: '[TouchA]', target: dueDate });
  expect(display().dueDate).toBe('hide_when_empty');
  await user.pointer({ keys: '[TouchA]', target: dueDate });
  expect(display().dueDate).toBe('hide');
  await user.pointer({ keys: '[TouchA]', target: dueDate });
  expect(display().dueDate).toBe('show');

  const trigger = screen.getByRole('button', {
    name: 'Change Due date visibility',
  });
  await user.pointer({ keys: '[TouchA]', target: trigger });
  expect(display().dueDate).toBe('show');
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('dialog', { name: 'Change Due date visibility' })
    )
  );
  const empty = await screen.findByRole('radio', {
    name: 'Hide when empty',
  });
  await user.click(empty);
  expect(display().dueDate).toBe('hide_when_empty');
  expect(open()).toBe(true);
  const hidden = screen.getByRole('radio', { name: 'Hide' });
  await user.click(hidden);
  expect(display().dueDate).toBe('hide');
  fireEvent.keyDown(hidden, { key: 'Escape' });
  await waitFor(() =>
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  );
  expect(open()).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.keyDown(trigger, { key: 'Escape' });
  await waitFor(() => expect(open()).toBe(false));
});
