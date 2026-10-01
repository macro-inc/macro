import type { executeMarkEntitiesUndone } from '@app/features/next-soup/utils';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import type { EmailArchiveDisposition } from '@queries/email/integration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type UndoneArgs = Parameters<typeof executeMarkEntitiesUndone>[0];
const mocks = vi.hoisted(() => ({
  threadCanBeMarkedNotDone: vi.fn(async (_id: string) => true),
  executeMarkEntitiesUndone:
    vi.fn<(args: UndoneArgs) => Promise<EmailArchiveDisposition>>(),
  outcomes: new Map<string, EmailArchiveDisposition | Error>(),
  writeGate: undefined as Promise<void> | undefined,
  notificationFailure: undefined as Error | undefined,
  applyOptimistic: vi.fn(
    (_args: {
      emailIds: string[];
      notificationIds: string[];
      reminderIds?: string[];
    }) => ({
      rollback: vi.fn(),
      settle: vi.fn(),
    })
  ),
  fetchDoneNotificationIds: vi.fn(async (ids: string[]) =>
    ids.map((id) => `server-${id}`)
  ),
  invalidateAllSoup: vi.fn(),
  refetchSoupEntity: vi.fn(async () => {}),
  resolveMarkEntitiesDoneVariables: vi.fn(
    ({ entities }: { entities: EntityData[] }) => ({
      emailIds: entities.map((e) => e.id),
      notificationIds: entities.map((e) => `local-${e.id}`),
    })
  ),
  alert: vi.fn(),
  failure: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: mocks.alert, failure: mocks.failure, success: mocks.success },
}));
vi.mock('@queries/email/thread', () => ({
  threadCanBeMarkedNotDone: mocks.threadCanBeMarkedNotDone,
}));
vi.mock('@queries/notification/user-notifications', () => ({
  fetchDoneNotificationIdsByEventItemIds: mocks.fetchDoneNotificationIds,
}));
vi.mock('@queries/soup/cache', () => ({
  invalidateAllSoup: mocks.invalidateAllSoup,
  refetchSoupEntity: mocks.refetchSoupEntity,
}));
vi.mock('@app/features/next-soup/utils', () => ({
  applyEntitiesNotDoneOptimistic: mocks.applyOptimistic,
  executeMarkEntitiesUndone: mocks.executeMarkEntitiesUndone,
  resolveMarkEntitiesDoneVariables: mocks.resolveMarkEntitiesDoneVariables,
}));

import { makeMarkNotDoneAction } from './make-mark-not-done-action';

const doneEmail = (id: string) =>
  ({ type: 'email', id, done: true }) as EntityData;
const createAction = () =>
  makeMarkNotDoneAction({
    notificationSource: () => ({}) as NotificationSource,
  });
function optimisticFor(id: string) {
  const index = mocks.applyOptimistic.mock.calls.findIndex(([args]) =>
    args.emailIds.includes(id)
  );
  return mocks.applyOptimistic.mock.results[index].value;
}

describe('makeMarkNotDoneAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outcomes.clear();
    mocks.writeGate = undefined;
    mocks.notificationFailure = undefined;
    mocks.threadCanBeMarkedNotDone.mockImplementation(async () => true);
    mocks.fetchDoneNotificationIds.mockImplementation(async (ids) =>
      ids.map((id) => `server-${id}`)
    );
    mocks.refetchSoupEntity.mockResolvedValue(undefined);
    mocks.executeMarkEntitiesUndone.mockImplementation(async (args) => {
      if (args.emailIds.length === 0) {
        if (mocks.notificationFailure) throw mocks.notificationFailure;
        return 'committed';
      }
      await mocks.writeGate;
      let failure: Error | undefined;
      let disposition: EmailArchiveDisposition = 'committed';
      for (const id of args.emailIds) {
        const outcome = mocks.outcomes.get(id) ?? 'committed';
        if (outcome instanceof Error) {
          failure ??= outcome;
          args.onEmailSettled?.(id, { status: 'rejected', reason: outcome });
        } else {
          args.onEmailSettled?.(id, { status: 'fulfilled', value: outcome });
          if (outcome === 'queued') disposition = outcome;
        }
      }
      if (failure) throw failure;
      return disposition;
    });
  });

  it('unarchives a thread and restores only its notifications', async () => {
    await expect(createAction().execute([doneEmail('inbound')])).resolves.toBe(
      'committed'
    );
    expect(mocks.executeMarkEntitiesUndone).toHaveBeenNthCalledWith(1, {
      emailIds: ['inbound'],
      notificationIds: [],
      onEmailSettled: expect.any(Function),
    });
    expect(mocks.executeMarkEntitiesUndone).toHaveBeenNthCalledWith(2, {
      emailIds: [],
      notificationIds: ['local-inbound', 'server-inbound'],
    });
    expect(optimisticFor('inbound').settle).toHaveBeenCalledOnce();
    expect(optimisticFor('inbound').rollback).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.invalidateAllSoup).toHaveBeenCalledOnce();
    expect(mocks.refetchSoupEntity).toHaveBeenCalledWith(
      'inbound',
      'emailThread'
    );
  });

  it('does not refetch REST caches after a queued unarchive', async () => {
    mocks.outcomes.set('inbound', 'queued');
    await expect(createAction().execute([doneEmail('inbound')])).resolves.toBe(
      'queued'
    );
    expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
    expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
  });

  it('still skips threads rejected by the legacy eligibility preflight', async () => {
    mocks.threadCanBeMarkedNotDone.mockResolvedValue(false);
    await createAction().execute([doneEmail('sent-only')]);
    expect(mocks.executeMarkEntitiesUndone).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledOnce();
  });

  it('unarchives only eligible threads in a legacy mixed selection', async () => {
    mocks.threadCanBeMarkedNotDone.mockImplementation(
      async (id) => id === 'inbound'
    );
    await createAction().execute([
      doneEmail('inbound'),
      doneEmail('sent-only'),
    ]);
    expect(mocks.executeMarkEntitiesUndone).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ emailIds: ['inbound'] })
    );
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it.each(['committed', 'queued'] as const)(
    'preserves a %s unarchive when a sent-only sibling is rejected by GraphQL',
    async (disposition) => {
      mocks.outcomes.set('inbound', disposition);
      mocks.outcomes.set(
        'sent-only',
        new Error('thread has no received messages')
      );
      await expect(
        createAction().execute([doneEmail('inbound'), doneEmail('sent-only')])
      ).resolves.toBe(disposition);
      expect(optimisticFor('inbound').settle).toHaveBeenCalledOnce();
      expect(optimisticFor('inbound').rollback).not.toHaveBeenCalled();
      expect(optimisticFor('sent-only').rollback).toHaveBeenCalledOnce();
      expect(optimisticFor('sent-only').settle).not.toHaveBeenCalled();
      expect(mocks.fetchDoneNotificationIds).toHaveBeenCalledWith(['inbound']);
      expect(mocks.executeMarkEntitiesUndone).toHaveBeenLastCalledWith({
        emailIds: [],
        notificationIds: ['local-inbound', 'server-inbound'],
      });
      expect(mocks.alert).toHaveBeenCalledWith(
        'Marked 1 of 2 items as not done. 1 could not be restored.',
        expect.any(Object)
      );
      expect(mocks.failure).not.toHaveBeenCalled();
      expect(mocks.refetchSoupEntity).not.toHaveBeenCalledWith(
        'sent-only',
        'emailThread'
      );
      if (disposition === 'queued') {
        expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
        expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
      }
    }
  );

  it('skips shared-list refresh for mixed committed, queued and rejected writes', async () => {
    mocks.outcomes.set('queued', 'queued');
    mocks.outcomes.set('rejected', new Error('cannot unarchive'));
    await expect(
      createAction().execute(['committed', 'queued', 'rejected'].map(doneEmail))
    ).resolves.toBe('queued');
    expect(mocks.fetchDoneNotificationIds).toHaveBeenCalledWith([
      'committed',
      'queued',
    ]);
    expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
    expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
    expect(optimisticFor('committed').rollback).not.toHaveBeenCalled();
    expect(optimisticFor('queued').rollback).not.toHaveBeenCalled();
  });

  it.each(['lookup', 'write'] as const)(
    'does not roll back accepted emails when notification %s fails',
    async (phase) => {
      if (phase === 'lookup')
        mocks.fetchDoneNotificationIds.mockRejectedValueOnce(
          new Error('lookup failed')
        );
      else mocks.notificationFailure = new Error('notification write failed');
      await expect(
        createAction().execute([doneEmail('inbound')])
      ).resolves.toBe('committed');
      expect(optimisticFor('inbound').rollback).not.toHaveBeenCalled();
      expect(mocks.alert).toHaveBeenCalledWith(
        'Marked as not done. Some notifications could not be restored.',
        expect.any(Object)
      );
      const notifications = mocks.applyOptimistic.mock.results.at(-1)!.value;
      expect(notifications.rollback).toHaveBeenCalledOnce();
      expect(notifications.settle).not.toHaveBeenCalled();
    }
  );

  it('keeps queued emails accepted when notification restoration is offline', async () => {
    mocks.outcomes.set('inbound', 'queued');
    mocks.fetchDoneNotificationIds.mockRejectedValueOnce(new Error('offline'));
    await expect(createAction().execute([doneEmail('inbound')])).resolves.toBe(
      'queued'
    );
    expect(optimisticFor('inbound').rollback).not.toHaveBeenCalled();
    expect(mocks.refetchSoupEntity).not.toHaveBeenCalled();
    expect(mocks.invalidateAllSoup).not.toHaveBeenCalled();
  });

  it('does not turn a refresh failure into a failed committed mutation', async () => {
    mocks.refetchSoupEntity.mockRejectedValueOnce(new Error('refresh failed'));
    await expect(createAction().execute([doneEmail('inbound')])).resolves.toBe(
      'committed'
    );
    expect(optimisticFor('inbound').rollback).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Marked as not done. The list could not be refreshed.',
      expect.any(Object)
    );
  });

  it('still rejects a completely failed selection for single-thread cache wrappers', async () => {
    const error = new Error('cannot unarchive');
    mocks.outcomes.set('sent-only', error);
    await expect(createAction().execute([doneEmail('sent-only')])).rejects.toBe(
      error
    );
    expect(optimisticFor('sent-only').rollback).toHaveBeenCalledOnce();
    expect(mocks.fetchDoneNotificationIds).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledWith('Failed to mark as not done');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('rolls back every field patch if the batch fails before any write result', async () => {
    mocks.executeMarkEntitiesUndone.mockRejectedValueOnce(
      new Error('cancel failed')
    );
    await expect(
      createAction().execute([doneEmail('a'), doneEmail('b')])
    ).rejects.toThrow('cancel failed');
    expect(optimisticFor('a').rollback).toHaveBeenCalledOnce();
    expect(optimisticFor('b').rollback).toHaveBeenCalledOnce();
  });

  it('patches all rows before waiting for the server and deduplicates repeated entities', async () => {
    const gate = Promise.withResolvers<void>();
    mocks.writeGate = gate.promise;
    const action = createAction().execute([
      doneEmail('a'),
      doneEmail('a'),
      doneEmail('b'),
    ]);
    await vi.waitFor(() =>
      expect(mocks.executeMarkEntitiesUndone).toHaveBeenCalledOnce()
    );
    expect(
      mocks.applyOptimistic.mock.calls.map(([args]) => args.emailIds)
    ).toEqual([['a'], ['b']]);
    expect(mocks.fetchDoneNotificationIds).not.toHaveBeenCalled();
    gate.resolve();
    await action;
  });

  it('does not resolve threads when nothing is done', async () => {
    await createAction().execute([
      { type: 'email', id: 'not-done', done: false } as EntityData,
    ]);
    expect(mocks.threadCanBeMarkedNotDone).not.toHaveBeenCalled();
    expect(mocks.executeMarkEntitiesUndone).not.toHaveBeenCalled();
  });
});
