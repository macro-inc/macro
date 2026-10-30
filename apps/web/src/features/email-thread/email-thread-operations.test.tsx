import type { MailboxOperation } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { onlineManager } from '@tanstack/query-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EmailThreadOperations,
  MailboxOperationsNotice,
} from './email-thread-operations';

const threadOperations = vi.hoisted(() => vi.fn());

// The notice is independent of request/cache state; no provider calls in these tests.
vi.mock('@queries/email/cache-cleanup', () => ({
  refreshEmailThreadCache: vi.fn(),
}));
vi.mock('@service-email/client', () => ({
  emailClient: { threadOperations },
}));
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.clearAllMocks();
});
const operation = (
  state: MailboxOperation['state'],
  action: MailboxOperation['action'] = {
    kind: 'category',
    value: { name: 'Projects', present: true },
  }
): MailboxOperation => ({
  id: 'operation',
  updated_at: '2026-10-04T00:00:00Z',
  state,
  action,
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

it.each(['fetching', 'paused', 'disabled'] as const)(
  'keeps a cached thread visible while mailbox status is %s',
  async (status) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const request = Promise.withResolvers<Ok<MailboxOperation[], unknown>>();
    const started = Promise.withResolvers<void>();
    threadOperations.mockImplementation(() => {
      started.resolve();
      return request.promise;
    });
    onlineManager.setOnline(status !== 'paused');
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<div>Loading thread</div>}>
          <p>Cached email body</p>
          <EmailThreadOperations
            threadId="cached-thread"
            enabled={status !== 'disabled'}
            announceRead={false}
          />
        </Suspense>
      </QueryClientProvider>
    ));

    if (status === 'fetching') await started.promise;
    expect(screen.queryByText('Loading thread')).toBeNull();
    const body = screen.getByText('Cached email body');

    if (status !== 'disabled') {
      onlineManager.setOnline(true);
      await started.promise;
      request.resolve(ok([operation('pending')]));
      await client.refetchQueries();
      expect(screen.getByText(/Waiting for mailbox confirmation/)).toBeTruthy();
      expect(screen.getByText('Cached email body')).toBe(body);
    }
    client.clear();
  }
);
it('does not announce the mark-as-read that opening a thread queues', () => {
  const read = { kind: 'read', value: true } as const;
  render(() => (
    <MailboxOperationsNotice operations={[operation('pending', read)]} />
  ));
  expect(screen.queryByText(/Mark as read/)).toBeNull();
});
it('announces a pending mark-as-read the user asked for', () => {
  const read = { kind: 'read', value: true } as const;
  render(() => (
    <MailboxOperationsNotice
      operations={[operation('pending', read)]}
      announceRead
    />
  ));
  expect(screen.getByText(/Mark as read/).textContent).toContain(
    'Waiting for mailbox confirmation'
  );
});
it('reports a mark-as-read that the mailbox rejected', () => {
  const read = { kind: 'read', value: true } as const;
  render(() => (
    <MailboxOperationsNotice operations={[operation('failed', read)]} />
  ));
  expect(screen.getByText(/Mark as read/).textContent).toContain(
    'Could not apply this change'
  );
});
it('still announces a pending mark-as-unread', () => {
  const unread = { kind: 'read', value: false } as const;
  render(() => (
    <MailboxOperationsNotice operations={[operation('pending', unread)]} />
  ));
  expect(screen.getByText(/Mark as unread/).textContent).toContain(
    'Waiting for mailbox confirmation'
  );
});
