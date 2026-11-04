import { queryClient } from '@queries/client';
import type { DatabaseWebhookResponse } from '@service-storage/generated/schemas/databaseWebhookResponse';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { onlineManager, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from '../../../lib/core/component/Toast/Toast';
import { databaseWebhookKeys } from '../queries/keys';
import { WebhooksDialog } from './WebhooksDialog';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    databases: {
      listWebhooks: api.list,
      createWebhook: api.create,
      deleteWebhook: api.remove,
    },
  },
}));
vi.mock('../../../lib/core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
const table: TableDetail = {
  table: {
    id: 'table',
    database_id: 'database',
    name: 'Contacts',
    position: 'a',
    version: 1,
  },
  columns: [],
  views: [],
  sql_name: '"Contacts"',
};
const webhook: DatabaseWebhookResponse = {
  id: 'webhook',
  databaseId: 'database',
  tableId: 'table',
  createdBy: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  tokenPrefix: 'secret',
};
function open() {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <WebhooksDialog databaseId="database" table={table} onClose={vi.fn()} />
    </QueryClientProvider>
  ));
}
beforeEach(() => {
  queryClient.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  api.list.mockReset().mockReturnValue(okAsync({ webhooks: [] }));
  api.create
    .mockReset()
    .mockReturnValue(okAsync({ webhook, token: 'secret-token' }));
  api.remove.mockReset().mockReturnValue(okAsync(undefined));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

it('creates once after the empty list loads and keeps deletion explicit', async () => {
  let loaded!: (value: { webhooks: DatabaseWebhookResponse[] }) => void;
  api.list.mockReturnValue(
    ResultAsync.fromSafePromise(
      new Promise((resolve) => {
        loaded = resolve;
      })
    )
  );
  open();
  expect(api.create).not.toHaveBeenCalled();
  loaded({ webhooks: [] });
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledExactlyOnceWith({
      id: 'database',
      tableId: 'table',
    })
  );
  expect(await screen.findByDisplayValue(/secret-token/)).toBeTruthy();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Delete webhook' })
  );
  await waitFor(() =>
    expect(api.remove).toHaveBeenCalledWith({
      id: 'database',
      webhookId: 'webhook',
    })
  );
  await waitFor(() =>
    expect(screen.queryByDisplayValue(/secret-token/)).toBeNull()
  );
  expect(api.create).toHaveBeenCalledTimes(1);
});
it('opens existing webhooks without creating and allows another explicitly', async () => {
  api.list.mockReturnValue(okAsync({ webhooks: [webhook] }));
  open();
  await screen.findByRole('button', { name: 'Delete webhook' });
  expect(api.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
  await screen.findByDisplayValue(/secret-token/);
  expect(api.create).toHaveBeenCalledTimes(1);
});
it('allows retrying a failed initial creation without an automatic retry loop', async () => {
  api.create.mockReturnValueOnce(errAsync(new Error('failed')));
  open();
  await waitFor(() =>
    expect(toast.failure).toHaveBeenCalledWith('Could not create a webhook.')
  );
  expect(api.create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
  await screen.findByDisplayValue(/secret-token/);
  expect(api.create).toHaveBeenCalledTimes(2);
});
it('does not create another webhook when reopening management', async () => {
  api.list.mockReturnValue(okAsync({ webhooks: [webhook] }));
  const first = open();
  await screen.findByRole('button', { name: 'Delete webhook' });
  first.unmount();
  open();
  await screen.findByRole('button', { name: 'Delete webhook' });
  expect(api.create).not.toHaveBeenCalled();
});

it('waits for the server before creating from an empty cached list', async () => {
  queryClient.setQueryData(databaseWebhookKeys.list('database').queryKey, {
    webhooks: [],
  });
  let loaded!: (value: { webhooks: DatabaseWebhookResponse[] }) => void;
  api.list.mockReturnValue(
    ResultAsync.fromSafePromise(
      new Promise((resolve) => {
        loaded = resolve;
      })
    )
  );
  open();
  expect(api.create).not.toHaveBeenCalled();
  loaded({ webhooks: [webhook] });
  await screen.findByRole('button', { name: 'Delete webhook' });
  expect(api.create).not.toHaveBeenCalled();
});

it('keeps the dialog open while the one-time URL is being created', async () => {
  let created!: (value: {
    webhook: DatabaseWebhookResponse;
    token: string;
  }) => void;
  api.create.mockReturnValue(
    ResultAsync.fromSafePromise(
      new Promise((resolve) => {
        created = resolve;
      })
    )
  );
  const close = vi.fn();
  render(() => (
    <QueryClientProvider client={queryClient}>
      <WebhooksDialog databaseId="database" table={table} onClose={close} />
    </QueryClientProvider>
  ));
  await screen.findByRole('button', { name: 'Creating…' });
  const done = screen.getByRole('button', { name: 'Done' });
  expect(done.hasAttribute('disabled')).toBe(true);
  fireEvent.click(done);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  created({ webhook, token: 'secret-token' });
  await screen.findByDisplayValue(/secret-token/);
  fireEvent.click(done);
  expect(close).toHaveBeenCalledOnce();
});

it('waits for a paused offline refetch before automatic creation', async () => {
  onlineManager.setOnline(false);
  queryClient.setQueryData(databaseWebhookKeys.list('database').queryKey, {
    webhooks: [],
  });
  open();
  await waitFor(() =>
    expect(
      queryClient.getQueryState(databaseWebhookKeys.list('database').queryKey)
        ?.fetchStatus
    ).toBe('paused')
  );
  expect(api.create).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
  await screen.findByDisplayValue(/secret-token/);
  expect(api.create).toHaveBeenCalledTimes(1);
});
