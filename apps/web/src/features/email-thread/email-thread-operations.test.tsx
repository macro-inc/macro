import type { MailboxOperation } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MailboxOperationsNotice } from './email-thread-operations';

// The notice is independent of request/cache state; no provider calls in these tests.
vi.mock('@queries/email/cache-cleanup', () => ({
  refreshEmailThreadCache: vi.fn(),
}));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
afterEach(cleanup);
const operation = (state: MailboxOperation['state']): MailboxOperation => ({
  id: 'operation',
  updated_at: '2026-10-04T00:00:00Z',
  state,
  action: { kind: 'category', value: { name: 'Projects', present: true } },
});
it('does not announce queued category changes as applied', () => {
  render(() => <MailboxOperationsNotice operations={[operation('pending')]} />);
  expect(
    screen.getByText(/Waiting for mailbox confirmation/).textContent
  ).toContain('Projects');
});
it('keeps a failed change visible and explains recovery', () => {
  render(() => <MailboxOperationsNotice operations={[operation('failed')]} />);
  expect(screen.getByText(/Could not apply this change/).textContent).toContain(
    'Try the action again'
  );
});
it('removes the pending notice once the provider confirms', () => {
  render(() => <MailboxOperationsNotice operations={[operation('applied')]} />);
  expect(screen.queryByText(/mailbox confirmation/)).toBeNull();
});
