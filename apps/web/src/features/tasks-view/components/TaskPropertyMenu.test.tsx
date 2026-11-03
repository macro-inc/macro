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
  ...(await import('../../../components/ui/components/Tooltip')),
  ...(await import('../../../components/ui/components/Tabs')),
  ...(await import('../../../components/ui/components/Popover')),
  ...(await import('../../../components/ui/components/Select')),
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
  vi.useRealTimers();
});

it('toggles two-state pills and opens three-state choices without changing their value', async () => {
  const user = userEvent.setup();
  const [display, setDisplay] = createSignal<TaskPropertyDisplay>({
    ...DEFAULT_TASK_PROPERTY_DISPLAY,
  });
  const [open, setOpen] = createSignal(true);
  render(() => (
    <HeaderActionGroup label="Display options">
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
  const tags = screen.getByRole('button', { name: 'Tags' });
  await user.click(tags);
  expect(display().tags).toBe('hide');
  expect(tags.getAttribute('aria-pressed')).toBe('false');
  tags.focus();
  await user.keyboard('{Enter}');
  expect(display().tags).toBe('show');
  expect(tags.getAttribute('aria-pressed')).toBe('true');

  const trigger = screen.getByRole('button', {
    name: 'Change Due date visibility',
  });
  await user.click(trigger);
  expect(display().dueDate).toBe('show');
  const hidden = await screen.findByRole('menuitemradio', { name: 'Hide' });
  await user.click(hidden);
  expect(display().dueDate).toBe('hide');
  expect(open()).toBe(true);
  fireEvent.keyDown(hidden, { key: 'Escape' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const empty = await screen.findByRole('menuitemradio', {
    name: 'Hide when empty',
  });
  fireEvent.keyDown(empty, { key: 'Enter' });
  expect(display().dueDate).toBe('hide_when_empty');
  expect(open()).toBe(true);
  expect(empty.getAttribute('aria-checked')).toBe('true');
});

it('opens visibility choices only on click and keeps them open after pointer exit', async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const [open, setOpen] = createSignal(true);
  render(() => (
    <HeaderActionGroup label="Display options">
      <ListViewMenu open={open()} onOpenChange={setOpen}>
        <TaskPropertyMenu
          display={DEFAULT_TASK_PROPERTY_DISPLAY}
          showProject
          onChange={vi.fn()}
        />
      </ListViewMenu>
    </HeaderActionGroup>
  ));
  const trigger = screen.getByRole('button', {
    name: 'Change Due date visibility',
  });
  await user.hover(trigger);
  await vi.advanceTimersByTimeAsync(150);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');

  await user.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByRole('menuitemradio', { name: 'Hide when empty' })
  ).toBeTruthy();
  expect(open()).toBe(true);

  await user.pointer({
    target: screen.getByRole('button', { name: 'Tags' }),
    coords: { clientX: 300, clientY: 300 },
  });
  await vi.advanceTimersByTimeAsync(350);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByRole('menuitemradio', { name: 'Hide when empty' })
  ).toBeTruthy();

  await user.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(open()).toBe(true);

  await user.click(trigger);
  const option = screen.getByRole('menuitemradio', { name: 'Hide when empty' });
  option.focus();
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(open()).toBe(true);
});

it('keeps Display open while touch pills and their visibility sheet change modes', async () => {
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
          onChange={(property, mode) =>
            setDisplay((current) =>
              taskPropertyDisplaySchema.parse({ ...current, [property]: mode })
            )
          }
        />
      </ListViewMenu>
    </>
  ));
  await user.click(screen.getByRole('button', { name: 'Display options' }));
  const tags = await screen.findByRole('button', { name: 'Tags' });
  await user.pointer({ keys: '[TouchA]', target: tags });
  expect(display().tags).toBe('hide');
  expect(tags.getAttribute('aria-pressed')).toBe('false');
  await user.pointer({ keys: '[TouchA]', target: tags });
  expect(display().tags).toBe('show');
  expect(tags.getAttribute('aria-pressed')).toBe('true');

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
