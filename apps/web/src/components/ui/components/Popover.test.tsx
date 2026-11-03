import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';
import { Popover } from './Popover';

vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  motionStyles.remove();
});

it('focuses form controls and restores the trigger after close and Escape', async () => {
  const user = userEvent.setup();
  render(() => (
    <Popover>
      <Popover.Trigger>Display</Popover.Trigger>
      <Popover.Content>
        <Popover.Title>Display options</Popover.Title>
        <input aria-label="Name" />
        <Popover.Close aria-label="Done">Done</Popover.Close>
      </Popover.Content>
    </Popover>
  ));
  const trigger = screen.getByRole('button', { name: 'Display' });
  await user.click(trigger);
  const name = await screen.findByRole('textbox', { name: 'Name' });
  await waitFor(() => expect(document.activeElement).toBe(name));
  await user.type(name, 'Weekly');
  expect(name).toHaveProperty('value', 'Weekly');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);

  await user.keyboard('{Enter}');
  await screen.findByRole('dialog', { name: 'Display options' });
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('dismisses on outside click without trapping focus or restoring it over the clicked control', async () => {
  const user = userEvent.setup();
  let scope: HTMLDivElement | undefined;
  render(() => (
    <div ref={scope} class="portal-scope">
      <Popover>
        <Popover.Trigger>Display</Popover.Trigger>
        <Popover.Content portalScope="local">
          <Popover.Title>Display options</Popover.Title>
          <input aria-label="Name" />
        </Popover.Content>
      </Popover>
      <button type="button">Outside</button>
    </div>
  ));
  await user.click(screen.getByRole('button', { name: 'Display' }));
  const dialog = await screen.findByRole('dialog', { name: 'Display options' });
  expect(dialog.closest('.portal-scope')).toBe(scope);
  const outside = screen.getByRole('button', { name: 'Outside' });
  await user.click(outside);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(outside);
});

it('keeps the popover open during nested dropdown selection and dismissal', async () => {
  const user = userEvent.setup();
  const [value, setValue] = createSignal('show');
  render(() => (
    <Popover>
      <Popover.Trigger>Display</Popover.Trigger>
      <Popover.Content>
        <Popover.Title>Display options</Popover.Title>
        <Dropdown modal={false}>
          <Dropdown.Trigger as="button">Visibility</Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.Group>
              <Dropdown.RadioGroup value={value()} onChange={setValue}>
                <Dropdown.RadioItem value="show" closeOnSelect={false}>
                  Show
                </Dropdown.RadioItem>
                <Dropdown.RadioItem value="hide" closeOnSelect={false}>
                  Hide
                </Dropdown.RadioItem>
              </Dropdown.RadioGroup>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Popover.Content>
    </Popover>
  ));
  const display = screen.getByRole('button', { name: 'Display' });
  await user.click(display);
  const visibility = await screen.findByRole('button', { name: 'Visibility' });
  await user.click(visibility);
  await user.click(await screen.findByRole('menuitemradio', { name: 'Hide' }));
  expect(value()).toBe('hide');
  expect(screen.getByRole('dialog', { name: 'Display options' })).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Display options' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(visibility));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(display);
});
