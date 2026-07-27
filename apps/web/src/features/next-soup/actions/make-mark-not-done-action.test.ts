import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  threadCanBeMarkedNotDone: vi.fn(async (_id: string) => true),
  executeMarkEntitiesUndone: vi.fn(async () => {}),
  resolveMarkEntitiesDoneVariables: vi.fn(
    ({ entities }: { entities: EntityData[] }) => ({
      emailIds: entities.map((e) => e.id),
      notificationIds: [],
    })
  ),
  alert: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    alert: mocks.alert,
    failure: vi.fn(),
    success: mocks.success,
  },
}));

vi.mock('@queries/email/thread', () => ({
  threadCanBeMarkedNotDone: mocks.threadCanBeMarkedNotDone,
}));

vi.mock('@queries/notification/user-notifications', () => ({
  fetchDoneNotificationIdsByEventItemIds: vi.fn(async () => []),
}));

vi.mock('@queries/soup/cache', () => ({
  invalidateAllSoup: vi.fn(),
  refetchSoupEntity: vi.fn(async () => {}),
}));

vi.mock('@app/features/next-soup/utils', () => ({
  applyEntitiesNotDoneOptimistic: vi.fn(() => ({ rollback: vi.fn() })),
  executeMarkEntitiesUndone: mocks.executeMarkEntitiesUndone,
  resolveMarkEntitiesDoneVariables: mocks.resolveMarkEntitiesDoneVariables,
}));

import { makeMarkNotDoneAction } from './make-mark-not-done-action';

const doneEmail = (id: string) =>
  ({ type: 'email', id, done: true }) as EntityData;

function createAction() {
  return makeMarkNotDoneAction({
    notificationSource: () => ({}) as NotificationSource,
  });
}

describe('makeMarkNotDoneAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.threadCanBeMarkedNotDone.mockImplementation(async () => true);
  });

  it('unarchives a thread that has an inbound message', async () => {
    await createAction().execute([doneEmail('inbound')]);

    expect(mocks.executeMarkEntitiesUndone).toHaveBeenCalledWith(
      expect.objectContaining({ emailIds: ['inbound'] })
    );
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  // A send-only thread is permanently done: unarchiving reverts on the next
  // server-side recompute and meanwhile labels its sent messages INBOX.
  it('skips a thread with no inbound message and explains why', async () => {
    mocks.threadCanBeMarkedNotDone.mockImplementation(async () => false);

    await createAction().execute([doneEmail('sent-only')]);

    expect(mocks.executeMarkEntitiesUndone).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it('unarchives only the eligible threads in a mixed selection', async () => {
    mocks.threadCanBeMarkedNotDone.mockImplementation(
      async (id: string) => id === 'inbound'
    );

    await createAction().execute([
      doneEmail('inbound'),
      doneEmail('sent-only'),
    ]);

    expect(mocks.executeMarkEntitiesUndone).toHaveBeenCalledWith(
      expect.objectContaining({ emailIds: ['inbound'] })
    );
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('does not resolve threads when nothing is done', async () => {
    await createAction().execute([
      { type: 'email', id: 'not-done', done: false } as EntityData,
    ]);

    expect(mocks.threadCanBeMarkedNotDone).not.toHaveBeenCalled();
    expect(mocks.executeMarkEntitiesUndone).not.toHaveBeenCalled();
  });
});
