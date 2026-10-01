import type { EntityData } from '@entity';
import type { useUndoableArchiveThreadMutation } from '@queries/email/thread';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailThread } from './core/email-thread';

type ArchiveOptions = Parameters<typeof useUndoableArchiveThreadMutation>[0];
const mocks = vi.hoisted(() => ({
  feature: vi.fn(() => ({ enabled: false })),
  lookup: vi.fn<() => { original: EntityData } | undefined>(),
  executeNotDone: vi.fn(async () => 'committed' as const),
  trackArchive: vi.fn(),
  mutate: vi.fn(
    (
      _params: { threadId: string; archive: boolean; linkId?: string },
      _callbacks?: {
        onSuccess: (disposition: 'committed' | 'queued') => Promise<void>;
      }
    ) => {}
  ),
  archiveOptions: undefined as ArchiveOptions | undefined,
  refetchSoupEntity: vi.fn(async () => {}),
  invalidateAllSoup: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.feature,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));
vi.mock('@app/features/entity/utils/buildEntityData', () => ({
  buildEntityData: vi.fn(),
}));
vi.mock('@app/features/next-soup/actions', () => ({
  makeMarkDoneAction: () => ({ execute: vi.fn(), executeWithSoup: vi.fn() }),
  makeMarkNotDoneAction: () => ({
    canExecute: () => true,
    execute: mocks.executeNotDone,
  }),
}));
vi.mock('@app/features/next-soup/soup-context', () => ({
  useMaybeSoup: () => ({ items: { get: mocks.lookup } }),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: vi.fn(),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(() => 1), failure: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('@notifications', () => ({
  compositeEntity: () => 'thread',
  setDoneOverride: vi.fn(),
}));
vi.mock(
  '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid',
  () => ({ default: () => null })
);
vi.mock('@queries/email/thread', () => ({
  trackExternalThreadArchive: mocks.trackArchive,
  useUndoableArchiveThreadMutation: (options: ArchiveOptions) => {
    mocks.archiveOptions = options;
    return { mutate: mocks.mutate };
  },
}));
vi.mock('@queries/notification/user-notifications', () => ({
  bulkMarkNotificationsAsDone: vi.fn(async () => {}),
  bulkMarkNotificationsAsUndone: vi.fn(async () => {}),
  fetchDoneNotificationIdsByEventItemIds: vi.fn(async () => []),
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  refetchSoupEntity: mocks.refetchSoupEntity,
  invalidateAllSoup: mocks.invalidateAllSoup,
}));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: () => false,
  mapApiSoupItemToEntity: vi.fn(),
}));

import { createThreadCompletionAdapter } from './thread-completion-adapter';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.feature.mockReturnValue({ enabled: false });
  mocks.lookup.mockReturnValue(undefined);
});
function setup(thread: EmailThread | undefined) {
  return createRoot((dispose) => {
    disposals.push(dispose);
    return createThreadCompletionAdapter(
      () => thread,
      (link) => link ?? undefined
    );
  });
}
const thread = (
  inbox_visible = false,
  latest_inbound_message_ts: string | null = null
): EmailThread => ({
  db_id: 'thread',
  link_id: 'link',
  access_level: 'owner',
  is_read: true,
  inbox_visible,
  latest_inbound_message_ts,
  messages: [],
});

describe('thread-header unarchive eligibility', () => {
  it('offers GraphQL unarchive with no inbox timestamp or complete message history', () => {
    mocks.feature.mockReturnValue({ enabled: true });
    const adapter = setup(thread());
    expect(adapter.canMarkThreadNotDone()).toBe(true);
    expect(adapter.markThreadNotDone()).toBe(true);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { threadId: 'thread', archive: false, linkId: 'link' },
      expect.any(Object)
    );
  });

  it('preserves the REST timestamp gate', () => {
    const missing = setup(thread());
    expect(missing.canMarkThreadNotDone()).toBe(false);
    expect(missing.markThreadNotDone()).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
    const received = setup(thread(false, '2026-10-01T10:00:00Z'));
    expect(received.canMarkThreadNotDone()).toBe(true);
  });

  it.each([false, true])(
    'rejects unloaded or already-open threads (GraphQL=%s)',
    (graphql) => {
      mocks.feature.mockReturnValue({ enabled: graphql });
      for (const value of [undefined, thread(true, '2026-10-01T10:00:00Z')]) {
        const adapter = setup(value);
        expect(adapter.canMarkThreadNotDone()).toBe(false);
        expect(adapter.markThreadNotDone()).toBe(false);
      }
      expect(mocks.mutate).not.toHaveBeenCalled();
    }
  );

  it('reacts when GraphQL is enabled after the thread snapshot loaded', () => {
    const [enabled, setEnabled] = createSignal(false);
    mocks.feature.mockImplementation(() => ({ enabled: enabled() }));
    createRoot((dispose) => {
      disposals.push(dispose);
      const adapter = createThreadCompletionAdapter(
        () => thread(),
        (link) => link ?? undefined
      );
      const canRestore = createMemo(adapter.canMarkThreadNotDone);
      expect(canRestore()).toBe(false);
      setEnabled(true);
      expect(canRestore()).toBe(true);
    });
  });

  it('routes a loaded GraphQL Soup entity through the shared unarchive action', () => {
    mocks.feature.mockReturnValue({ enabled: true });
    const entity = { type: 'email', id: 'thread', done: true } as EntityData;
    mocks.lookup.mockReturnValue({ original: entity });
    const adapter = setup(thread());
    expect(adapter.markThreadNotDone()).toBe(true);
    expect(mocks.executeNotDone).toHaveBeenCalledWith([entity]);
    expect(mocks.trackArchive).toHaveBeenCalledWith(
      'thread',
      expect.any(Promise),
      false
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

describe('direct unarchive fallback reconciliation', () => {
  it.each([false, true])(
    'refetches REST Soup only on the REST path (GraphQL=%s)',
    async (graphql) => {
      mocks.feature.mockReturnValue({ enabled: graphql });
      const adapter = setup(thread(false, '2026-10-01T10:00:00Z'));
      adapter.markThreadNotDone();
      await mocks.mutate.mock.calls[0][1]!.onSuccess('committed');
      if (graphql) {
        expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
        expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
      } else {
        expect(mocks.refetchSoupEntity).toHaveBeenCalledWith(
          'thread',
          'emailThread'
        );
        expect(mocks.invalidateAllSoup).toHaveBeenCalledOnce();
      }
    }
  );

  it.each([false, true])(
    'preserves transport-specific Undo/Redo side effects (GraphQL=%s)',
    (graphql) => {
      mocks.feature.mockReturnValue({ enabled: graphql });
      setup(thread(false, '2026-10-01T10:00:00Z'));
      const lifecycle = mocks.archiveOptions!.onPushed!(
        { id: 'undo', undo: vi.fn(async () => {}), dispose: vi.fn() },
        { threadId: 'thread', archive: false },
        () => 'committed'
      );
      if (!lifecycle) throw Error('Missing undo lifecycle');
      lifecycle.onUndone?.();
      lifecycle.onRedone?.();
      if (graphql) {
        expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
        expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
      } else {
        expect(mocks.refetchSoupEntity).toHaveBeenCalledOnce();
        expect(mocks.invalidateAllSoup).toHaveBeenCalledTimes(2);
      }
    }
  );
});
