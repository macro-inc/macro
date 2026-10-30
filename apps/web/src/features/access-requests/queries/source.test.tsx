import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SharingSource } from '../context/contracts';
import type { AccessRequest, RequestState, ShareEntity } from '../core/types';
import { createSharingSource } from './source';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  grants: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
}));
let snapshot: {
  isSuccess: boolean;
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  data: RequestState;
  refetch: () => Promise<void>;
};
let offset: Accessor<number>;
vi.mock('@queries/access-requests/requests', () => ({
  accessRequestsClient: { submit: mocks.submit, grants: mocks.grants },
  refreshSharedAccess: mocks.refresh,
  invalidateAccessRequests: mocks.invalidate,
  useAccessRequestState: (
    _entity: unknown,
    _enabled: unknown,
    currentOffset: Accessor<number>
  ) => {
    offset = currentOffset;
    return snapshot;
  },
}));

const first: ShareEntity = { entityType: 'document', entityId: 'first' };
const second: ShareEntity = { entityType: 'document', entityId: 'second' };
const request: AccessRequest = {
  id: 'request',
  requesterId: 'macro|requester@macro.com',
  requestedLevel: 'edit',
  status: 'pending',
  revision: 1,
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grants.mockImplementation(() => okAsync([]));
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

function mount(initial: Partial<RequestState> = {}) {
  const [entity, navigate] = createSignal<ShareEntity>(first);
  const [data, update] = createStore<RequestState>({
    canReview: false,
    accessLevel: null,
    supportedLevels: ['view', 'comment', 'edit'],
    requests: [],
    pendingCount: 0,
    nextOffset: 50,
    ...initial,
  });
  snapshot = {
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isError: false,
    data,
    refetch: async () => {},
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let source!: SharingSource;
  function Host() {
    source = createSharingSource(entity, () => true);
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>
  ));
  return { source, navigate, update };
}

it.each(['success', 'failure'] as const)(
  'keeps a pending mutation on its original document after navigation (%s)',
  async (outcome) => {
    const pending = Promise.withResolvers<AccessRequest>();
    const started = Promise.withResolvers<void>();
    mocks.submit.mockImplementation(() => {
      started.resolve();
      return ResultAsync.fromPromise(pending.promise, () => [
        { code: 'NETWORK_ERROR', message: 'offline' },
      ]);
    });
    const { source, navigate } = mount();
    const result = source.submit('edit');
    const settled =
      outcome === 'failure' ? expect(result).rejects.toThrow() : result;
    navigate(second);
    source.nextPage();
    expect(offset()).toBe(50);
    await started.promise;
    expect(mocks.submit).toHaveBeenCalledWith(first, 'edit', undefined);
    if (outcome === 'success') pending.resolve(request);
    else pending.reject(new Error('offline'));
    await settled;
    expect(offset()).toBe(50);
    if (outcome === 'success') {
      expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(first);
      expect(mocks.invalidate).not.toHaveBeenCalled();
    } else {
      expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith(first);
      expect(mocks.refresh).not.toHaveBeenCalled();
    }
  }
);

it('loads direct grants for an authorized reviewer without file access', async () => {
  const loaded = Promise.withResolvers<void>();
  mocks.grants.mockImplementation(() => {
    loaded.resolve();
    return okAsync([]);
  });
  const { update } = mount();
  expect(mocks.grants).not.toHaveBeenCalled();
  update('canReview', true);
  await loaded.promise;
  expect(mocks.grants).toHaveBeenCalledExactlyOnceWith(first);
});

it('keeps loaded request and grant rows available through a failed background refresh', async () => {
  const grants = [{ userId: 'macro|reader@macro.com', accessLevel: 'view' }];
  mocks.grants.mockImplementation(() => okAsync(grants));
  const { source } = mount({ accessLevel: 'view', mine: request });
  await source.refresh();
  expect(source.state()?.mine).toEqual(request);
  expect(source.grants()).toEqual(grants);
  snapshot.isSuccess = false;
  snapshot.isError = true;
  mocks.grants.mockImplementation(() =>
    errAsync([{ code: 'NETWORK_ERROR', message: 'offline' }])
  );
  await source.refresh();
  expect(source.error()).toBe('Could not load access requests.');
  expect(source.state()?.mine).toEqual(request);
  expect(source.grants()).toEqual(grants);
});

it('does not show the previous document grant rows while the new document is pending', async () => {
  const grants = [{ userId: 'macro|reader@macro.com', accessLevel: 'view' }];
  mocks.grants.mockImplementation(() => okAsync(grants));
  const { source, navigate } = mount({ accessLevel: 'view', mine: request });
  await source.refresh();
  expect(source.grants()).toEqual(grants);
  const pending = Promise.withResolvers<never[]>();
  mocks.grants.mockImplementation(() =>
    ResultAsync.fromSafePromise(pending.promise)
  );
  snapshot.isPending = true;
  snapshot.isSuccess = false;
  navigate(second);
  expect(source.state()).toBeUndefined();
  expect(source.grants()).toEqual([]);
  pending.resolve([]);
});
