import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailThread } from './core/email-thread';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn<() => { original: EntityData } | undefined>(),
  executeNotDone: vi.fn(async () => 'committed' as const),
  trackArchive: vi.fn(),
  mutate: vi.fn(
    (
      _params: { threadId: string; archive: boolean },
      _callbacks?: { onSuccess: () => Promise<void> }
    ) => {}
  ),
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
  '@icon/system/regular/arrow-counter-clockwise.svg?component-solid',
  () => ({ default: () => null })
);
vi.mock('@queries/email/thread', () => ({
  trackExternalThreadArchive: mocks.trackArchive,
  useUndoableArchiveThreadMutation: () => ({ mutate: mocks.mutate }),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  bulkMarkNotificationsAsDone: vi.fn(async () => {}),
  bulkMarkNotificationsAsUndone: vi.fn(async () => {}),
  fetchDoneNotificationIdsByEventItemIds: vi.fn(async () => []),
}));
vi.mock('@queries/soup/cache', () => ({ getSoupEntityById: vi.fn() }));
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
  mocks.lookup.mockReturnValue(undefined);
});
function setup(thread: EmailThread | undefined) {
  return createRoot((dispose) => {
    disposals.push(dispose);
    return createThreadCompletionAdapter(() => thread);
  });
}
const thread = (
  inbox_visible = false,
  latest_inbound_message_ts: string | null = null,
  has_received_mail = true
): EmailThread => ({
  db_id: 'thread',
  link_id: 'link',
  access_level: 'owner',
  is_read: true,
  inbox_visible,
  has_received_mail,
  latest_inbound_message_ts,
  messages: [],
});

describe('thread-header unarchive eligibility', () => {
  it('offers unarchive with no inbox timestamp or complete message history', () => {
    const adapter = setup(thread());
    expect(adapter.canMarkThreadNotDone()).toBe(true);
    expect(adapter.markThreadNotDone()).toBe(true);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { threadId: 'thread', archive: false },
      expect.any(Object)
    );
  });

  it('rejects unloaded or already-open threads', () => {
    for (const value of [undefined, thread(true, '2026-10-01T10:00:00Z')]) {
      const adapter = setup(value);
      expect(adapter.canMarkThreadNotDone()).toBe(false);
      expect(adapter.markThreadNotDone()).toBe(false);
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('never unarchives a done thread with no received mail', () => {
    mocks.lookup.mockReturnValue({
      original: { type: 'email', id: 'thread', done: true } as EntityData,
    });
    // A draft's edit time can stand in for the inbound timestamp until the
    // thread is recomputed, so the timestamp alone cannot prove received mail.
    const adapter = setup(thread(false, '2026-10-01T10:00:00Z', false));
    expect(adapter.canMarkThreadNotDone()).toBe(false);
    expect(adapter.markThreadNotDone()).toBe(false);
    expect(mocks.executeNotDone).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('routes a loaded Soup entity through the shared unarchive action', () => {
    const entity = { type: 'email', id: 'thread', done: true } as EntityData;
    mocks.lookup.mockReturnValue({ original: entity });
    const adapter = setup(thread());
    expect(adapter.markThreadNotDone()).toBe(true);
    expect(mocks.executeNotDone).toHaveBeenCalledWith([entity]);
    expect(mocks.trackArchive).toHaveBeenCalledWith(expect.any(Promise));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
