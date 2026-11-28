import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerActiveGraphqlSoupQuery } from '../soup/graphql/active-queries';
import { markSenderNoiseWithToast } from './thread';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  remove: vi.fn(),
  captureConnection: vi.fn(),
  profile: vi.fn(),
  invalidateRest: vi.fn(),
  success: vi.fn(),
  background: [] as Promise<unknown>[],
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    upsertEmailFilter: mocks.upsert,
    deleteEmailFilter: mocks.remove,
  },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  captureGraphqlSoupUpdateConnection: mocks.captureConnection,
}));
vi.mock('@service-storage/mail-cache-profile', () => ({
  mailCacheProfile: mocks.profile,
}));
vi.mock('../soup/normalized-cache', () => ({
  invalidateAllSoup: mocks.invalidateRest,
}));
vi.mock('../soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('./integration', () => ({ archiveEmailThread: vi.fn() }));
vi.mock('./graphql/thread', () => ({
  createGraphqlEmailThreadQuery: vi.fn(),
  fetchGraphqlEmailThread: vi.fn(),
  mapGraphqlThreadError: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: vi.fn() },
}));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (promise: Promise<unknown>) => mocks.background.push(promise),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.background.length = 0;
});

function mountImportanceReaders() {
  const maintained = vi.fn(async () => {});
  const network = vi.fn(async () => {});
  const unrelated = vi.fn(async () => {});
  const stop = [
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: maintained,
      body: () => ({ ef: { l: { Importance: true } } }),
      cacheMaintained: () => true,
    }),
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: network,
      body: () => ({ ef: { '!': { l: { Importance: false } } } }),
    }),
    registerActiveGraphqlSoupQuery({
      isEnabled: () => true,
      refresh: unrelated,
      body: () => ({ ef: { l: { Subject: 'synthetic' } } }),
    }),
  ];
  return {
    maintained,
    network,
    unrelated,
    dispose: () => stop.forEach((fn) => fn()),
  };
}

it.each([
  {
    name: 'covered browser',
    cap: false,
    connection: () => true,
    profile: 'browser',
    refreshMaintained: false,
  },
  {
    name: 'covered mobile',
    cap: false,
    connection: () => true,
    profile: 'native_supported',
    refreshMaintained: false,
  },
  {
    name: 'legacy profile',
    cap: false,
    connection: () => true,
    profile: 'native_unsupported',
    refreshMaintained: true,
  },
  {
    name: 'capped publish',
    cap: true,
    connection: () => true,
    profile: 'browser',
    refreshMaintained: true,
  },
  {
    name: 'older server',
    cap: undefined,
    connection: () => true,
    profile: 'browser',
    refreshMaintained: true,
  },
  {
    name: 'missing subscription',
    cap: false,
    connection: undefined,
    profile: 'browser',
    refreshMaintained: true,
  },
  {
    name: 'interrupted subscription',
    cap: false,
    connection: () => false,
    profile: 'browser',
    refreshMaintained: true,
  },
])(
  'refreshes matching readers after a $name write',
  async ({ cap, connection, profile, refreshMaintained }) => {
    const readers = mountImportanceReaders();
    try {
      mocks.captureConnection.mockReturnValue(connection);
      mocks.profile.mockResolvedValue({ outcome: profile });
      mocks.upsert.mockResolvedValue(
        ok({ filter: { id: 'rule' }, push_was_capped: cap })
      );
      await markSenderNoiseWithToast('sender@example.com', 'link');
      await Promise.all(mocks.background);
      expect(readers.maintained).toHaveBeenCalledTimes(
        Number(refreshMaintained)
      );
      expect(readers.network).toHaveBeenCalledOnce();
      expect(readers.unrelated).not.toHaveBeenCalled();
      expect(mocks.invalidateRest).toHaveBeenCalledOnce();
    } finally {
      readers.dispose();
    }
  }
);

it('checks the connection and publication coverage again when undo deletes the rule', async () => {
  const readers = mountImportanceReaders();
  try {
    mocks.captureConnection.mockReturnValue(() => true);
    mocks.profile.mockResolvedValue({ outcome: 'browser' });
    mocks.upsert.mockResolvedValue(
      ok({ filter: { id: 'rule' }, push_was_capped: false })
    );
    mocks.remove.mockResolvedValue(ok({ push_was_capped: true }));
    await markSenderNoiseWithToast('sender@example.com', 'link');
    await Promise.all(mocks.background);
    expect(readers.maintained).not.toHaveBeenCalled();

    await mocks.success.mock.calls[0]?.[1].actions[0].onClick();
    await Promise.all(mocks.background);

    expect(mocks.remove).toHaveBeenCalledWith({ id: 'rule' }, 'link');
    expect(mocks.captureConnection).toHaveBeenCalledTimes(2);
    expect(readers.maintained).toHaveBeenCalledOnce();
    expect(readers.network).toHaveBeenCalledTimes(2);
  } finally {
    readers.dispose();
  }
});
