/** @vitest-environment jsdom */
import { Telemetry } from '@macro-inc/observability';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ImperativeDialogHost } from '@ui';
import { createRoot, getOwner } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EmailProviderSelectionDialog,
  selectEmailProvider,
} from './ProviderDialog';

const providers = vi.hoisted(() => vi.fn());
vi.mock('@queries/auth/outlook-link', () => ({
  fetchEmailConnectionProviders: providers,
}));
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('opens immediately and retries provider discovery without silently choosing Gmail', async () => {
  const pending = Promise.withResolvers<{ outlook: boolean; imap: boolean }>();
  providers
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ outlook: false, imap: true });
  const selected = vi.fn();
  render(() => (
    <EmailProviderSelectionDialog
      open
      onOpenChange={() => {}}
      mailOnly
      onSelect={selected}
    />
  ));
  expect(screen.getByRole('status').textContent).toContain(
    'Loading email providers'
  );
  expect(screen.queryByRole('button', { name: 'Gmail' })).toBeNull();
  pending.reject(new Error('availability unavailable'));
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not load email providers'
  );
  expect(selected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Other email (IMAP / SMTP)' })
  );
  expect(selected).toHaveBeenCalledExactlyOnceWith('IMAP');
  expect(providers).toHaveBeenCalledTimes(2);
});

it('keeps IMAP hidden when connecting a calendar even when enrollment is enabled', async () => {
  providers.mockResolvedValue({ outlook: true, imap: true });
  render(() => (
    <EmailProviderSelectionDialog
      open
      onOpenChange={() => {}}
      mailOnly={false}
      onSelect={() => {}}
    />
  ));
  await screen.findByRole('button', { name: /Outlook/ });
  expect(
    screen.queryByRole('button', { name: 'Other email (IMAP / SMTP)' })
  ).toBeNull();
});

it.each([
  { gmail: true, outlook: false, expected: 'GMAIL' },
  { gmail: false, outlook: true, expected: 'OUTLOOK' },
])(
  'starts the sole $expected provider directly without another click',
  async ({ gmail, outlook, expected }) => {
    providers.mockResolvedValue({ gmail, outlook, imap: false });
    const selected = vi.fn();
    render(() => (
      <EmailProviderSelectionDialog
        open
        onOpenChange={() => {}}
        mailOnly
        onSelect={selected}
      />
    ));
    await vi.waitFor(() =>
      expect(selected).toHaveBeenCalledExactlyOnceWith(expected)
    );
  }
);

it('waits for a successful retry before starting a sole Gmail provider', async () => {
  providers
    .mockRejectedValueOnce(new Error('availability unavailable'))
    .mockResolvedValueOnce({ gmail: true, outlook: false, imap: false });
  const selected = vi.fn();
  render(() => (
    <EmailProviderSelectionDialog
      open
      onOpenChange={() => {}}
      mailOnly
      onSelect={selected}
    />
  ));
  await screen.findByRole('alert');
  expect(selected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await vi.waitFor(() =>
    expect(selected).toHaveBeenCalledExactlyOnceWith('GMAIL')
  );
});

it.each([
  { action: 'choose', reason: 'completed', selected: 'IMAP' },
  { action: 'cancel', reason: 'dismissed', selected: undefined },
  { action: 'dispose', reason: 'owner-disposed', selected: undefined },
])(
  'records why the provider chooser closes: $reason',
  async ({ action, reason, selected }) => {
    providers.mockResolvedValue({ gmail: true, outlook: true, imap: true });
    const span = Telemetry.span('test.dialog-close');
    const attribute = vi.spyOn(span, 'setAttr');
    const ended = vi.spyOn(span, 'end');
    vi.spyOn(Telemetry, 'span').mockReturnValue(span);
    render(() => <ImperativeDialogHost />);
    const owner = createRoot((dispose) => ({ owner: getOwner(), dispose }));
    const selection = selectEmailProvider(owner.owner);
    const imap = await screen.findByRole('button', {
      name: 'Other email (IMAP / SMTP)',
    });
    if (action === 'choose') fireEvent.click(imap);
    else if (action === 'cancel')
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    else owner.dispose();
    expect(await selection).toBe(selected);
    expect(attribute).toHaveBeenCalledWith('dialog.close_reason', reason);
    expect(ended).toHaveBeenCalled();
    owner.dispose();
  }
);
