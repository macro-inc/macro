import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { createTaskForAccount } from './create';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  seed: vi.fn(),
  preview: vi.fn(),
  quota: vi.fn(),
  track: vi.fn(),
  current: true,
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: mocks.track } }));
vi.mock('@block-chat/definition', () => ({ DEFAULT_CHAT_NAME: 'Chat' }));
vi.mock('@core/constant/PaywallState', () => ({
  PaywallKey: {},
  usePaywallState: vi.fn(),
}));
vi.mock('@queries/auth', () => ({ invalidateUserQuota: mocks.quota }));
vi.mock('@queries/auth/account-scope', () => ({
  assertQueryAccount: (owner: unknown) => {
    if (!owner || !mocks.current) throw new Error('Query account changed');
  },
}));
vi.mock('@queries/history/history', () => ({ postNewHistoryItem: vi.fn() }));
vi.mock('@queries/preview/preview', () => ({
  setPreviewOnCreate: mocks.preview,
}));
vi.mock('@queries/soup/cache', () => ({
  refetchSoupEntity: vi.fn(async () => {}),
}));
vi.mock('@queries/storage/documentLoad/documentLoadBundle', () => ({
  seedDocumentLoadBundle: mocks.seed,
}));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-static-files/client', () => ({ staticFileClient: {} }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { createTask: mocks.create },
}));
vi.mock('@service-storage/util/uploadToPresignedUrl', () => ({
  uploadToPresignedUrl: vi.fn(),
}));
vi.mock('./handlePaymentError', () => ({ isPaymentError: vi.fn() }));
vi.mock('./hash', () => ({ contentHash: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = true;
  mocks.quota.mockResolvedValue(undefined);
});

it('guards task dispatch and refuses to seed a previous account response', async () => {
  const reply = Promise.withResolvers<unknown>();
  const entered = Promise.withResolvers<void>();
  mocks.create.mockImplementation(async () => {
    entered.resolve();
    return await reply.promise;
  });
  const owner = { userId: 'macro|viewer@example.com', session: 0 };
  const pending = createTaskForAccount(owner, { title: 'Task' });
  await entered.promise;
  mocks.current = false;
  reply.resolve(
    ok({ documentId: 'task', documentMetadata: {}, token: 'fixture' })
  );
  await expect(pending).rejects.toThrow('Query account changed');
  expect(mocks.seed).not.toHaveBeenCalled();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.quota).not.toHaveBeenCalled();
  expect(mocks.track).not.toHaveBeenCalled();
  await expect(createTaskForAccount(owner)).rejects.toThrow(
    'Query account changed'
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it('uses the normal task lifecycle when the captured account remains current', async () => {
  mocks.create.mockResolvedValue(
    ok({ documentId: 'task', documentMetadata: {}, token: 'fixture' })
  );
  expect(
    await createTaskForAccount(
      { userId: 'macro|viewer@example.com', session: 0 },
      { title: 'Task' }
    )
  ).toBe('task');
  expect(mocks.seed).toHaveBeenCalledTimes(1);
  expect(mocks.preview).toHaveBeenCalledTimes(1);
  expect(mocks.track).toHaveBeenCalledTimes(1);
});
