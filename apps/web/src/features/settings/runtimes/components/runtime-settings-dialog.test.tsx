// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { beforeAll, expect, it, vi } from 'vitest';
import { RuntimeSettingsDialog } from './runtime-settings-dialog';

beforeAll(() => vi.stubGlobal('scrollTo', vi.fn()));

it('focuses the first setting and restores the row trigger when closed and reopened', async () => {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  render(() => (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        Configure runtime
      </button>
      <Show when={open()}>
        <RuntimeSettingsDialog
          title="Test runtime"
          returnFocus={() => trigger}
          description="Configure your account."
          busy={false}
          onClose={() => setOpen(false)}
        >
          <label>
            API key
            <input aria-label="API key" />
          </label>
        </RuntimeSettingsDialog>
      </Show>
    </>
  ));
  trigger = screen.getByRole('button', {
    name: 'Configure runtime',
  }) as HTMLButtonElement;
  trigger.focus();
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'API key' })
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'API key' })
    )
  );
});

it('blocks dismissal while an account or configuration request is pending', () => {
  const onClose = vi.fn();
  render(() => (
    <RuntimeSettingsDialog
      title="Test runtime"
      description="Configure your account."
      busy
      onClose={onClose}
    >
      <input aria-label="API key" />
    </RuntimeSettingsDialog>
  ));
  expect(screen.getByRole('button', { name: 'Done' })).toHaveProperty(
    'disabled',
    true
  );
  expect(
    screen.getByRole('button', { name: 'Close Test runtime settings' })
  ).toHaveProperty('disabled', true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});
