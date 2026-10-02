import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import {
  MutationUndoProvider,
  type UndoHandle,
  useMutationUndoContext,
} from '@queries/undo';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DoneWriteArgs,
  notificationReceipt,
  reportDoneWriteOutcomes,
} from './tests/done-write-fixture';

const mocks = vi.hoisted(() => ({
  graphql: true,
  home: false,
  notificationIdsForEntity: undefined as
    | ((entity: EntityData) => string[])
    | undefined,
  done: vi.fn(async (_args: DoneWriteArgs) => [] as string[]),
  undone: vi.fn(async (_args: DoneWriteArgs) => {}),
  report: undefined as typeof reportDoneWriteOutcomes | undefined,
  apply: vi.fn(() => ({
    applyUndone: vi.fn(),
    reapply: vi.fn(),
    rollback: vi.fn(),
    settle: vi.fn(),
    releaseGraphql: vi.fn(),
  })),
  toast: {
    success: vi.fn(() => 1),
    alert: vi.fn(() => 2),
    dismiss: vi.fn(),
    failure: vi.fn(),
  },
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({
    handle: {
      content: () => ({ id: mocks.home ? 'home' : 'other' }),
      referredFrom: () => undefined,
    },
  }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: mocks.toast }));
vi.mock('./graphql-done-optimism', () => ({
  applyGraphqlDoneOptimistic: mocks.apply,
}));
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: (entity: EntityData) => ({
    type: entity.type,
    id: entity.id,
  }),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  applyEntitiesDoneOptimistic: mocks.apply,
  executeMarkEntitiesDone: async (args: DoneWriteArgs) => {
    const [result] = await Promise.allSettled([mocks.done(args)]);
    (mocks.report ?? reportDoneWriteOutcomes)(args, result);
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  },
  executeMarkEntitiesUndone: async (args: DoneWriteArgs) => {
    const [result] = await Promise.allSettled([mocks.undone(args)]);
    (mocks.report ?? reportDoneWriteOutcomes)(
      args,
      result.status === 'fulfilled'
        ? { status: 'fulfilled', value: [] }
        : result
    );
    if (result.status === 'rejected') throw result.reason;
  },
  resolveMarkEntitiesDoneVariables: ({
    entities,
  }: {
    entities: EntityData[];
  }) => ({
    emailIds: entities
      .filter(({ type }) => type === 'email')
      .map(({ id }) => id),
    notificationIds: mocks.notificationIdsForEntity
      ? entities.flatMap(mocks.notificationIdsForEntity)
      : ['locally-known-id'],
    reminderIds: entities
      .filter(({ type }) => type === 'reminder')
      .map(({ id }) => id),
  }),
  restoreSoupFocus: vi.fn(async () => {}),
}));

import { makeMarkDoneAction } from './make-mark-done-action';

const email = (id = 'email-1') => ({ type: 'email', id }) as EntityData;
const cleanup: (() => void)[] = [];

function mount() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  let action!: ReturnType<typeof makeMarkDoneAction>;
  let undo!: ReturnType<typeof useMutationUndoContext>;
  createRoot((dispose) => {
    cleanup.push(() => {
      dispose();
      client.clear();
    });
    const Capture = () => {
      undo = useMutationUndoContext();
      action = makeMarkDoneAction({
        notificationSource: () => ({}) as NotificationSource,
      });
      return null;
    };
    return (
      <QueryClientProvider client={client}>
        <MutationUndoProvider>
          <Capture />
        </MutationUndoProvider>
      </QueryClientProvider>
    );
  });
  return { action, undo };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.graphql = true;
  mocks.home = false;
  mocks.notificationIdsForEntity = undefined;
  mocks.report = undefined;
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

describe('pending GraphQL Done undo', () => {
  it('registers immediately, restores locally, then reverses only the authoritative IDs', async () => {
    const write = Promise.withResolvers<string[]>();
    const inverse = Promise.withResolvers<void>();
    mocks.done.mockReturnValueOnce(write.promise);
    mocks.undone.mockReturnValueOnce(inverse.promise);
    const { action, undo } = mount();
    const restoreFocus = vi.fn();
    const navigateBack = vi.fn();
    const done = action.execute([email()], restoreFocus, { navigateBack });
    await vi.waitFor(() => expect(undo.canUndo()).toBe(true));
    expect(mocks.toast.success).toHaveBeenCalledOnce();
    const context = mocks.apply.mock.results[0].value;

    const reversal = undo.undo();
    expect(context.applyUndone).toHaveBeenCalledOnce();
    expect(restoreFocus).toHaveBeenCalledOnce();
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(mocks.toast.dismiss).toHaveBeenCalledWith(1);
    expect(mocks.undone).not.toHaveBeenCalled();
    expect(context.settle).not.toHaveBeenCalled();

    write.resolve(['authoritative-id']);
    await done;
    await vi.waitFor(() =>
      expect(mocks.undone).toHaveBeenCalledWith({
        emailIds: ['email-1'],
        notificationIds: ['authoritative-id'],
        reminderIds: [],
        onWriteSettled: expect.any(Function),
      })
    );
    // Done's late success cannot acknowledge the pending Undo display intent.
    expect(context.settle).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledOnce();
    inverse.resolve();
    await reversal;
    expect(context.settle).toHaveBeenCalledExactlyOnceWith([]);
    expect(
      mocks.apply.mock.results[1].value.settle
    ).toHaveBeenCalledExactlyOnceWith(['authoritative-id']);
    expect(undo.canRedo()).toBe(true);
    await undo.redo();
    expect(mocks.done).toHaveBeenLastCalledWith({
      emailIds: ['email-1'],
      notificationIds: ['authoritative-id'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
  });

  it.each([false, true])(
    'discards failed Done history, including an in-flight Undo (undo=%s)',
    async (requestUndo) => {
      const write = Promise.withResolvers<string[]>();
      mocks.done.mockReturnValueOnce(write.promise);
      const { action, undo } = mount();
      const done = action.execute([email()]);
      const failed = expect(done).rejects.toThrow('rejected');
      await vi.waitFor(() => expect(undo.canUndo()).toBe(true));
      const reversal = requestUndo ? undo.undo() : Promise.resolve();
      write.reject(new Error('rejected'));
      await failed;
      await reversal;
      expect(mocks.apply.mock.results[0].value.rollback).toHaveBeenCalledOnce();
      expect(mocks.undone).not.toHaveBeenCalled();
      expect(undo.canUndo()).toBe(false);
      expect(undo.canRedo()).toBe(false);
      expect(mocks.toast.dismiss).toHaveBeenCalledWith(1);
      expect(mocks.toast.failure).toHaveBeenCalledExactlyOnceWith(
        'Failed to mark as done'
      );
    }
  );

  it('keeps a failed reversal retryable without pinning guessed GraphQL state', async () => {
    const write = Promise.withResolvers<string[]>();
    mocks.done.mockReturnValueOnce(write.promise);
    mocks.undone.mockRejectedValueOnce(new Error('inverse failed'));
    const { action, undo } = mount();
    const done = action.execute([email()]);
    await vi.waitFor(() => expect(undo.canUndo()).toBe(true));
    const onError = vi.fn();
    const reversal = undo.undo({ onError });
    write.resolve(['exact']);
    await done;
    await reversal;
    const context = mocks.apply.mock.results[0].value;
    expect(context.reapply).toHaveBeenCalledOnce();
    expect(context.releaseGraphql).toHaveBeenCalledOnce();
    expect(context.settle).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'inverse failed' })
    );
    expect(undo.canUndo()).toBe(true);
    expect(undo.canRedo()).toBe(false);
    await undo.undo();
    expect(mocks.undone).toHaveBeenLastCalledWith({
      emailIds: ['email-1'],
      notificationIds: ['exact'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
  });

  it('does not register a second entry when a disposed pending Done succeeds', async () => {
    const write = Promise.withResolvers<string[]>();
    mocks.done.mockReturnValueOnce(write.promise);
    const { action, undo } = mount();
    let handle!: UndoHandle;
    const done = action.execute([email()], undefined, {
      onUndoHandle: (value) => {
        handle = value;
      },
    });
    await vi.waitFor(() => expect(handle).toBeDefined());
    handle.dispose();
    write.resolve(['exact']);
    await done;
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });

  it('isolates concurrent actions and cannot borrow a sibling reply for Undo', async () => {
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    mocks.done
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { action, undo } = mount();
    let firstHandle!: UndoHandle;
    const doneFirst = action.execute([email('first')], undefined, {
      onUndoHandle: (handle) => {
        firstHandle = handle;
      },
    });
    await vi.waitFor(() => expect(firstHandle).toBeDefined());
    const reversal = firstHandle.undo();
    const doneSecond = action.execute([email('second')]);
    await vi.waitFor(() => expect(mocks.done).toHaveBeenCalledTimes(2));
    second.resolve(['second-exact']);
    await doneSecond;
    expect(mocks.undone).not.toHaveBeenCalled();
    first.resolve(['first-exact']);
    await doneFirst;
    await reversal;
    expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
      emailIds: ['first'],
      notificationIds: ['first-exact'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
    expect(undo.canUndo()).toBe(true);
    // The second action cleared redo history while the first Undo was pending.
    expect(undo.canRedo()).toBe(false);
  });

  it.each([false, true])(
    'preserves a queued archive and undoes only it when siblings fail (early=%s)',
    async (early) => {
      const write = Promise.withResolvers<string[]>();
      mocks.done.mockReturnValueOnce(write.promise);
      mocks.report = (args, result) => {
        if (!args.notificationEntities)
          return reportDoneWriteOutcomes(args, result);
        args.onWriteSettled?.({
          kind: 'email',
          id: 'accepted',
          result: { status: 'fulfilled', value: 'queued' },
        });
        args.onWriteSettled?.({
          kind: 'email',
          id: 'rejected',
          result: { status: 'rejected', reason: new Error('archive rejected') },
        });
        args.onWriteSettled?.({
          kind: 'entity-notifications',
          result: {
            status: 'rejected',
            reason: new Error('notification rejected'),
          },
        });
      };
      const { action, undo } = mount();
      const done = action.execute([email('accepted'), email('rejected')]);
      await vi.waitFor(() => expect(undo.canUndo()).toBe(true));
      const reversal = early ? undo.undo() : undefined;
      write.reject(new Error('partial failure'));
      await done;
      const accepted = mocks.apply.mock.results[0].value;
      const rejected = mocks.apply.mock.results[1].value;
      expect(accepted.rollback).not.toHaveBeenCalled();
      expect(rejected.rollback).toHaveBeenCalledOnce();
      expect(mocks.toast.alert).toHaveBeenCalled();
      if (early) await reversal;
      else await undo.undo();
      expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
        emailIds: ['accepted'],
        notificationIds: [],
        reminderIds: [],
        onWriteSettled: expect.any(Function),
      });
      expect(undo.canRedo()).toBe(true);
      await undo.redo();
      expect(mocks.done).toHaveBeenLastCalledWith({
        emailIds: ['accepted'],
        notificationIds: [],
        reminderIds: [],
        onWriteSettled: expect.any(Function),
      });
      expect(rejected.reapply).not.toHaveBeenCalled();
    }
  );

  it('rolls back no-op notification overrides when the archive fails and nothing was accepted', async () => {
    mocks.done.mockRejectedValueOnce(new Error('archive rejected'));
    mocks.report = (args) => {
      args.onWriteSettled?.({
        kind: 'email',
        id: 'email-1',
        result: { status: 'rejected', reason: new Error('archive rejected') },
      });
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: { status: 'fulfilled', value: [] },
      });
    };
    const { action, undo } = mount();
    await expect(action.execute([email()])).rejects.toThrow('archive rejected');
    expect(mocks.apply.mock.results[0].value.rollback).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.results[1].value.rollback).toHaveBeenCalledOnce();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
  });

  it('retains exact notification receipts when the archive fails', async () => {
    mocks.done.mockRejectedValueOnce(new Error('archive rejected'));
    mocks.report = (args, result) => {
      if (!args.notificationEntities)
        return reportDoneWriteOutcomes(args, result);
      args.onWriteSettled?.({
        kind: 'email',
        id: 'email-1',
        result: { status: 'rejected', reason: new Error('archive rejected') },
      });
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: {
          status: 'fulfilled',
          value: [
            notificationReceipt('changed-on-server', {
              type: 'email',
              id: 'email-1',
            }),
          ],
        },
      });
    };
    const { action, undo } = mount();
    await action.execute([email()]);
    expect(undo.canUndo()).toBe(true);
    expect(mocks.apply.mock.results[0].value.rollback).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.results[1].value.rollback).not.toHaveBeenCalled();
    await undo.undo();
    expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
      emailIds: [],
      notificationIds: ['changed-on-server'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
    await undo.redo();
    expect(mocks.done).toHaveBeenLastCalledWith({
      emailIds: [],
      notificationIds: ['changed-on-server'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
  });

  it('isolates reminder failure from accepted email and document writes', async () => {
    mocks.done.mockRejectedValueOnce(new Error('reminder rejected'));
    mocks.report = (args, result) => {
      if (!args.notificationEntities)
        return reportDoneWriteOutcomes(args, result);
      args.onWriteSettled?.({
        kind: 'email',
        id: 'email-1',
        result: { status: 'fulfilled', value: 'committed' },
      });
      args.onWriteSettled?.({
        kind: 'reminder',
        id: 'reminder-1',
        result: { status: 'rejected', reason: new Error('reminder rejected') },
      });
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: {
          status: 'fulfilled',
          value: [
            notificationReceipt('doc-exact', {
              type: 'document',
              id: 'document-1',
            }),
          ],
        },
      });
    };
    const { action, undo } = mount();
    await action.execute([
      email(),
      { type: 'reminder', id: 'reminder-1' } as EntityData,
      { type: 'document', id: 'document-1' } as EntityData,
    ]);
    await undo.undo();
    expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
      emailIds: ['email-1'],
      notificationIds: ['doc-exact'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
    expect(mocks.apply.mock.results[1].value.rollback).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.results[0].value.rollback).not.toHaveBeenCalled();
    // The email/reminder notification writes were no-ops; only the document
    // notification attempt has an accepted receipt.
    expect(mocks.apply.mock.results[2].value.rollback).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.results[3].value.rollback).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.results[4].value.rollback).not.toHaveBeenCalled();
  });

  it.each(['undo', 'redo'] as const)(
    'retries only failed %s writes, not already accepted siblings',
    async (direction) => {
      const { action, undo } = mount();
      await action.execute([email('accepted'), email('retry')]);
      if (direction === 'redo') await undo.undo();
      const writer = direction === 'undo' ? mocks.undone : mocks.done;
      writer.mockRejectedValueOnce(new Error('partial inverse failure'));
      mocks.report = (args) => {
        args.onWriteSettled?.({
          kind: 'email',
          id: 'accepted',
          result: { status: 'fulfilled', value: 'committed' },
        });
        args.onWriteSettled?.({
          kind: 'email',
          id: 'retry',
          result: { status: 'rejected', reason: new Error('retry this write') },
        });
      };
      const onError = vi.fn();
      await undo[direction]({ onError });
      expect(onError).toHaveBeenCalledOnce();
      mocks.report = undefined;
      writer.mockClear();
      await undo[direction]();
      expect(writer).toHaveBeenCalledExactlyOnceWith({
        emailIds: ['retry'],
        notificationIds: [],
        reminderIds: [],
        onWriteSettled: expect.any(Function),
      });
    }
  );

  it.each(['empty', 'unmatched'] as const)(
    'releases a %s receipt instead of pinning the hide after discarding Undo',
    async (receipt) => {
      mocks.report = (args) =>
        args.onWriteSettled?.({
          kind: 'entity-notifications',
          result: {
            status: 'fulfilled',
            value:
              receipt === 'empty'
                ? []
                : [
                    notificationReceipt('unrelated', {
                      type: 'document',
                      id: 'other-document',
                    }),
                  ],
          },
        });
      const { action, undo } = mount();
      await action.execute([
        { type: 'document', id: 'document-1' } as EntityData,
      ]);
      const optimistic = mocks.apply.mock.results[0].value;
      expect(optimistic.rollback).toHaveBeenCalledOnce();
      expect(optimistic.settle).not.toHaveBeenCalled();
      expect(undo.canUndo()).toBe(false);
      expect(undo.canRedo()).toBe(false);
      expect(mocks.toast.dismiss).toHaveBeenCalledWith(1);
    }
  );

  it('keeps notification snapshots separate for different entity types sharing an id', async () => {
    mocks.notificationIdsForEntity = (entity) => [
      `${entity.type}-notification`,
    ];
    const { action } = mount();
    await action.execute([
      email('same-id'),
      { type: 'document', id: 'same-id' } as EntityData,
    ]);
    expect(mocks.apply).toHaveBeenNthCalledWith(2, {
      entityIds: [],
      notificationIds: ['email-notification'],
      scopeChannelThreads: false,
    });
    expect(mocks.apply).toHaveBeenNthCalledWith(3, {
      entityIds: ['same-id'],
      notificationIds: ['document-notification'],
      scopeChannelThreads: false,
    });
  });

  it('never guesses notification IDs when an early Undo receives a no-op reply', async () => {
    const write = Promise.withResolvers<string[]>();
    mocks.done.mockReturnValueOnce(write.promise);
    const { action, undo } = mount();
    const done = action.execute([
      { type: 'document', id: 'document-1' } as EntityData,
    ]);
    await vi.waitFor(() => expect(undo.canUndo()).toBe(true));
    const reversal = undo.undo();
    write.resolve([]);
    await done;
    await reversal;
    expect(mocks.undone).not.toHaveBeenCalled();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);
    expect(mocks.apply.mock.results[0].value.rollback).toHaveBeenCalledOnce();
  });

  it('does not restore or redo a no-op row using a sibling notification receipt', async () => {
    mocks.done.mockResolvedValueOnce(['changed']);
    const { action, undo } = mount();
    await action.execute([
      { type: 'document', id: 'changed-doc' } as EntityData,
      { type: 'document', id: 'unchanged-doc' } as EntityData,
    ]);
    await undo.undo();
    const changed = mocks.apply.mock.results[0].value;
    const unchanged = mocks.apply.mock.results[1].value;
    expect(unchanged.rollback).toHaveBeenCalledOnce();
    expect(unchanged.settle).not.toHaveBeenCalled();
    expect(changed.rollback).not.toHaveBeenCalled();
    expect(changed.applyUndone).toHaveBeenCalledOnce();
    expect(unchanged.applyUndone).not.toHaveBeenCalled();
    await undo.redo();
    expect(changed.reapply).toHaveBeenCalledOnce();
    expect(unchanged.reapply).not.toHaveBeenCalled();
    expect(mocks.done).toHaveBeenLastCalledWith({
      emailIds: [],
      notificationIds: ['changed'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
  });

  it('matches thread receipts by their thread, not just their shared channel', async () => {
    mocks.home = true;
    mocks.report = (args, result) => {
      if (!args.notificationEntities)
        return reportDoneWriteOutcomes(args, result);
      const notification = notificationReceipt('thread-exact', {
        type: 'channel',
        id: 'shared-channel',
      });
      notification.notification_metadata = {
        tag: 'channel_message_reply',
        content: { threadId: 'root-a', messageId: 'reply-a' },
      } as typeof notification.notification_metadata;
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: { status: 'fulfilled', value: [notification] },
      });
    };
    const { action, undo } = mount();
    await action.execute([
      {
        type: 'channel_thread',
        id: 'row-a',
        channelId: 'shared-channel',
        messageId: 'root-a',
      } as EntityData,
      {
        type: 'channel_thread',
        id: 'row-b',
        channelId: 'shared-channel',
        messageId: 'root-b',
      } as EntityData,
    ]);
    await undo.undo();
    expect(
      mocks.apply.mock.results[0].value.applyUndone
    ).toHaveBeenCalledOnce();
    expect(
      mocks.apply.mock.results[1].value.applyUndone
    ).not.toHaveBeenCalled();
    expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
      emailIds: [],
      notificationIds: ['thread-exact'],
      reminderIds: [],
      onWriteSettled: expect.any(Function),
    });
  });

  it('does not re-show a disposed action when partial outcomes arrive', async () => {
    const write = Promise.withResolvers<string[]>();
    mocks.done.mockReturnValueOnce(write.promise);
    mocks.report = (args) => {
      args.onWriteSettled?.({
        kind: 'email',
        id: 'email-1',
        result: { status: 'fulfilled', value: 'committed' },
      });
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: { status: 'rejected', reason: new Error('failed') },
      });
    };
    const { action, undo } = mount();
    let handle!: UndoHandle;
    const done = action.execute([email()], undefined, {
      onUndoHandle: (value) => {
        handle = value;
      },
    });
    await vi.waitFor(() => expect(handle).toBeDefined());
    handle.dispose();
    write.reject(new Error('partial failure'));
    await done;
    expect(undo.canUndo()).toBe(false);
    expect(mocks.toast.success).toHaveBeenCalledOnce();
    expect(mocks.toast.alert).not.toHaveBeenCalled();
  });

  it('deduplicates repeated group occurrences before writing', async () => {
    const { action } = mount();
    await action.execute([email(), email()]);
    expect(mocks.done).toHaveBeenCalledWith(
      expect.objectContaining({
        emailIds: ['email-1'],
        notificationEntities: [{ type: 'email', id: 'email-1' }],
      })
    );
  });

  for (const graphql of [false, true]) {
    it.each([false, true])(
      `never offers generic Undo for a follow-up mirror (GraphQL=${graphql}, failure=%s)`,
      async (failure) => {
        mocks.graphql = graphql;
        const write = Promise.withResolvers<string[]>();
        mocks.done.mockReturnValueOnce(write.promise);
        const mirror = {
          type: 'reminder',
          id: 'mirror',
          emailFollowup: { threadId: 'thread' },
        } as EntityData;
        const { action, undo } = mount();
        const onUndoHandle = vi.fn();
        const done = action.execute([mirror], undefined, { onUndoHandle });
        const result = failure
          ? expect(done).rejects.toThrow('mirror failed')
          : done;
        await vi.waitFor(() => expect(mocks.done).toHaveBeenCalledOnce());
        expect(undo.canUndo()).toBe(false);
        expect(onUndoHandle).not.toHaveBeenCalled();
        expect(mocks.toast.success).not.toHaveBeenCalled();
        if (failure) write.reject(new Error('mirror failed'));
        else write.resolve([]);
        await result;
        expect(undo.canUndo()).toBe(false);
        expect(onUndoHandle).not.toHaveBeenCalled();
        await undo.undo();
        expect(mocks.undone).not.toHaveBeenCalled();
        if (failure) expect(mocks.toast.success).not.toHaveBeenCalled();
        else
          expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(
            'Marked as done. Use Remind me to schedule the email again.'
          );
      }
    );
  }

  it.each([false, true])(
    'keeps ordinary GraphQL reminders immediately undoable after a mirror settles (mirror failure=%s)',
    async (failure) => {
      const mirrorWrite = Promise.withResolvers<string[]>();
      const ordinaryWrite = Promise.withResolvers<string[]>();
      mocks.done
        .mockReturnValueOnce(mirrorWrite.promise)
        .mockReturnValueOnce(ordinaryWrite.promise);
      const mirror = {
        type: 'reminder',
        id: 'mirror',
        emailFollowup: { threadId: 'thread' },
      } as EntityData;
      const ordinary = { type: 'reminder', id: 'ordinary' } as EntityData;
      const { action, undo } = mount();
      const done = action.execute([mirror, ordinary]);
      const result = failure
        ? expect(done).rejects.toThrow('mirror failed')
        : done;
      await vi.waitFor(() => expect(mocks.done).toHaveBeenCalledOnce());
      expect(undo.canUndo()).toBe(false);
      if (failure) mirrorWrite.reject(new Error('mirror failed'));
      else mirrorWrite.resolve([]);
      await vi.waitFor(() => {
        expect(mocks.done).toHaveBeenCalledTimes(2);
        expect(undo.canUndo()).toBe(true);
      });
      const reversal = undo.undo();
      expect(mocks.undone).not.toHaveBeenCalled();
      ordinaryWrite.resolve([]);
      await result;
      await reversal;
      expect(mocks.undone).toHaveBeenCalledExactlyOnceWith({
        emailIds: [],
        notificationIds: [],
        reminderIds: ['ordinary'],
        onWriteSettled: expect.any(Function),
      });
    }
  );

  it('reports partial mirror failure without offering an invalid Undo', async () => {
    mocks.done.mockRejectedValueOnce(new Error('completion failed'));
    mocks.report = (args) => {
      args.onWriteSettled?.({
        kind: 'reminder',
        id: 'mirror',
        result: { status: 'rejected', reason: new Error('completion failed') },
      });
      args.onWriteSettled?.({
        kind: 'entity-notifications',
        result: {
          status: 'fulfilled',
          value: [
            notificationReceipt('exact', { type: 'reminder', id: 'mirror' }),
          ],
        },
      });
    };
    const { action, undo } = mount();
    await action.execute([
      {
        type: 'reminder',
        id: 'mirror',
        emailFollowup: { threadId: 'thread' },
      } as EntityData,
    ]);
    expect(undo.canUndo()).toBe(false);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.alert).toHaveBeenCalledExactlyOnceWith(
      'Some changes could not be saved.'
    );
  });

  it('retains success-only registration for REST', async () => {
    mocks.graphql = false;
    const write = Promise.withResolvers<string[]>();
    mocks.done.mockReturnValueOnce(write.promise);
    const { action, undo } = mount();
    const done = action.execute([email()]);
    await vi.waitFor(() => expect(mocks.done).toHaveBeenCalledOnce());
    expect(undo.canUndo()).toBe(false);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    write.resolve([]);
    await done;
    expect(undo.canUndo()).toBe(true);
    await undo.undo();
    expect(mocks.undone).toHaveBeenCalledWith({
      emailIds: ['email-1'],
      notificationIds: ['locally-known-id'],
      reminderIds: [],
    });
  });
});
