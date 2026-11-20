/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailProviderSelectionDialog } from './ProviderDialog';

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
