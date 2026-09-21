import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStarterDatabase } from './starter-database';

const mocks = vi.hoisted(() => ({
  flag: { enabled: true, loading: false },
  userId: 'macro|new@macro.com' as string | undefined,
  databases: { isSuccess: true, data: [] as unknown[] | undefined },
  ensureStarter: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  options: undefined as
    | undefined
    | (() => { enabled: boolean; queryFn: () => Promise<unknown> }),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag,
}));
vi.mock('@core/constant/featureFlags', () => ({ enableDatabases: {} }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.userId }));
vi.mock('@core/util/result', () => ({
  throwOnErr: (call: () => unknown) => call(),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabasesQuery: () => mocks.databases,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    databases: { ensureStarter: () => mocks.ensureStarter() },
  },
}));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: (options: typeof mocks.options) => {
    mocks.options = options;
    return {};
  },
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.flag = { enabled: true, loading: false };
  mocks.userId = 'macro|new@macro.com';
  mocks.databases = { isSuccess: true, data: [] };
  mocks.ensureStarter.mockResolvedValue({
    created: true,
    databaseId: 'example',
    tableId: 'ideas',
    viewId: 'board',
  });
  useStarterDatabase();
});

describe('starter onboarding', () => {
  it('waits for the flag, identity, and a successful empty list', () => {
    const enabled = () => mocks.options!().enabled;
    expect(enabled()).toBe(true);
    mocks.flag.loading = true;
    expect(enabled()).toBe(false);
    mocks.flag = { enabled: false, loading: false };
    expect(enabled()).toBe(false);
    mocks.flag.enabled = true;
    mocks.userId = undefined;
    expect(enabled()).toBe(false);
    mocks.userId = 'macro|new@macro.com';
    Object.assign(mocks.databases, { isSuccess: false, data: undefined });
    expect(enabled()).toBe(false);
    Object.assign(mocks.databases, { isSuccess: true, data: [{}] });
    expect(enabled()).toBe(false);
    expect(mocks.ensureStarter).not.toHaveBeenCalled();
  });

  it('opens the newly seeded board and refreshes discovery and view caches', async () => {
    await mocks.options!().queryFn();
    const selection = createUserScopedStorage(
      'database-view-selection:example'
    ).read(mocks.userId!);
    expect(JSON.parse(selection!)).toEqual({
      tableId: 'ideas',
      views: { ideas: 'board' },
      drafts: {},
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('does not replace an existing browser view preference', async () => {
    const storage = createUserScopedStorage('database-view-selection:example');
    storage.write(mocks.userId!, 'existing preference');
    await mocks.options!().queryFn();
    expect(storage.read(mocks.userId!)).toBe('existing preference');
  });

  it('does not write a preference or refresh when the deleted example stays absent', async () => {
    mocks.ensureStarter.mockResolvedValue({
      created: false,
      databaseId: null,
      tableId: null,
      viewId: null,
    });
    await mocks.options!().queryFn();
    expect(localStorage.length).toBe(0);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it('keeps failed provisioning retryable without marking it complete', async () => {
    mocks.ensureStarter.mockRejectedValueOnce(new Error('offline'));
    await expect(mocks.options!().queryFn()).rejects.toThrow('offline');
    expect(localStorage.length).toBe(0);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    await mocks.options!().queryFn();
    expect(mocks.ensureStarter).toHaveBeenCalledTimes(2);
  });
});
