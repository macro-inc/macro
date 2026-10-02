import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupState } from '../create-soup-state';

const mocks = vi.hoisted(() => ({
  splitHandle: {
    content: vi.fn(() => ({ id: 'other' })),
    referredFrom: vi.fn(() => undefined),
  },
  executeMarkEntitiesDone: vi.fn(async () => [] as string[]),
  executeMarkEntitiesUndone: vi.fn(async () => {}),
  graphqlSoupEnabled: vi.fn(() => false),
  mutateAsync: vi.fn(async (_variables: unknown) => {}),
  openEntityInSplitFromUnifiedList: vi.fn(async () => {}),
  resolveMarkEntitiesDoneVariables: vi.fn(() => ({
    emailIds: [] as string[],
    notificationIds: [] as string[],
    reminderIds: [] as string[],
  })),
  toNotificationEntityRef: vi.fn(),
  undoableOptionsFactory: vi.fn(),
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: mocks.splitHandle }),
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: mocks.graphqlSoupEnabled,
}));

vi.mock(
  '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid',
  () => ({ default: () => null })
);

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    dismiss: vi.fn(),
    failure: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: mocks.toNotificationEntityRef,
  updateNotificationsForEntities: vi.fn(),
}));

vi.mock('@queries/undo', () => ({
  useUndoableMutation: (optionsFactory: () => unknown) => {
    mocks.undoableOptionsFactory.mockImplementation(optionsFactory);
    return { mutateAsync: mocks.mutateAsync };
  },
}));

vi.mock('@app/features/next-soup/utils', () => ({
  applyEntitiesDoneOptimistic: vi.fn(),
  executeMarkEntitiesDone: mocks.executeMarkEntitiesDone,
  executeMarkEntitiesUndone: mocks.executeMarkEntitiesUndone,
  openEntityInSplitFromUnifiedList: mocks.openEntityInSplitFromUnifiedList,
  resolveMarkEntitiesDoneVariables: mocks.resolveMarkEntitiesDoneVariables,
  restoreSoupFocus: vi.fn(),
}));

import {
  canExecuteMarkDoneOnView,
  makeMarkDoneAction,
} from './make-mark-done-action';

const currentEntity = {
  type: 'email',
  id: 'current',
} as EntityData;
const nextEntity = {
  type: 'email',
  id: 'next',
} as EntityData;
const notificationSource = {} as NotificationSource;

function createSoup() {
  const focusSet = vi.fn();
  const nextRow = { id: 'next-row', original: nextEntity };
  const soup = {
    focus: {
      id: () => 'current-row',
      set: focusSet,
    },
    selection: {
      clear: vi.fn(),
    },
    items: {
      count: () => 2,
      get: vi.fn(),
    },
    navigate: {
      peekOffset: vi.fn(() => ({ index: 1, row: nextRow })),
    },
    collapseEntity: {
      shouldCollapse: () => false,
      callback: vi.fn(),
    },
  } as unknown as SoupState;
  return { soup, focusSet };
}

function createAction() {
  return createRoot((dispose) => ({
    action: makeMarkDoneAction({
      notificationSource: () => notificationSource,
    }),
    dispose,
  }));
}

describe('canExecuteMarkDoneOnView', () => {
  it('allows mark done on every thread-listing mail tab', () => {
    for (const tab of [
      'important',
      'noise',
      'favorites',
      'calendar',
      'shared',
      'all',
    ]) {
      expect(canExecuteMarkDoneOnView('mail', tab)).toBe(true);
    }
  });

  it('keeps mark done off tabs whose rows are not triaged', () => {
    expect(canExecuteMarkDoneOnView('mail', 'drafts')).toBe(false);
    expect(canExecuteMarkDoneOnView('mail', 'sent')).toBe(false);
  });
});

describe('makeMarkDoneAction', () => {
  beforeEach(() => {
    mocks.splitHandle.content.mockReturnValue({ id: 'other' });
    mocks.splitHandle.referredFrom.mockReturnValue(undefined);
    mocks.executeMarkEntitiesDone.mockClear();
    mocks.executeMarkEntitiesDone.mockResolvedValue([]);
    mocks.executeMarkEntitiesUndone.mockClear();
    mocks.graphqlSoupEnabled.mockReturnValue(false);
    mocks.mutateAsync.mockClear();
    mocks.openEntityInSplitFromUnifiedList.mockClear();
    mocks.resolveMarkEntitiesDoneVariables.mockReset();
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: [],
      notificationIds: [],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReset();
  });

  it('allows mark done on agent-session rows', () => {
    const { action, dispose } = createAction();

    expect(
      action.canExecute({
        type: 'agent_session',
        id: 'session-1',
      } as EntityData)
    ).toBe(true);
    expect(
      action.canExecute({ type: 'channel_message', id: 'msg-1' } as EntityData)
    ).toBe(false);
    dispose();
  });

  it('keeps ordinary reminders undoable when selected with a workflow mirror', async () => {
    const mirror = {
      type: 'reminder',
      id: 'mirror',
      emailFollowup: { threadId: 'thread' },
    } as EntityData;
    const ordinary = { type: 'reminder', id: 'ordinary' } as EntityData;
    const { action, dispose } = createAction();
    const onUndoHandle = vi.fn();
    await action.execute([mirror, ordinary], undefined, { onUndoHandle });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    const mirrorVariables = mocks.mutateAsync.mock.calls[0][0];
    const ordinaryVariables = mocks.mutateAsync.mock.calls[1][0];
    expect(mirrorVariables).toMatchObject({ entities: [mirror] });
    expect(ordinaryVariables).toMatchObject({
      entities: [ordinary],
      onUndoHandle,
    });
    const options = mocks.undoableOptionsFactory() as {
      onPushed: (
        handle: { dispose: () => void },
        variables: unknown
      ) => unknown;
    };
    const mirrorHandle = { dispose: vi.fn() };
    const ordinaryHandle = { dispose: vi.fn() };
    options.onPushed(mirrorHandle, mirrorVariables);
    options.onPushed(ordinaryHandle, ordinaryVariables);
    expect(mirrorHandle.dispose).toHaveBeenCalledOnce();
    expect(ordinaryHandle.dispose).not.toHaveBeenCalled();
    expect(onUndoHandle).toHaveBeenCalledWith(ordinaryHandle);
    dispose();
  });

  it.each(['resolve', 'reject'] as const)(
    'waits for the mirror to %s before publishing ordinary Undo',
    async (settlement) => {
      const mirror = {
        type: 'reminder',
        id: 'mirror',
        emailFollowup: { threadId: 'thread' },
      } as EntityData;
      const ordinary = { type: 'reminder', id: 'ordinary' } as EntityData;
      let resolveMirror!: () => void;
      let rejectMirror!: (reason: Error) => void;
      const pendingMirror = new Promise<void>((resolve, reject) => {
        resolveMirror = resolve;
        rejectMirror = reject;
      });
      const failure = new Error('mirror failed');
      const { action, dispose } = createAction();
      const onUndoHandle = vi.fn();
      const ordinaryHandle = { dispose: vi.fn() };
      const options = mocks.undoableOptionsFactory() as {
        onPushed: (
          handle: { dispose: () => void },
          variables: unknown
        ) => unknown;
      };
      mocks.mutateAsync.mockImplementationOnce(() => pendingMirror);
      mocks.mutateAsync.mockImplementationOnce(async (variables) => {
        options.onPushed(ordinaryHandle, variables);
      });
      try {
        const result = action
          .execute([mirror, ordinary], undefined, { onUndoHandle })
          .catch((error) => error);
        await Promise.resolve();
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
        expect(onUndoHandle).not.toHaveBeenCalled();
        if (settlement === 'reject') rejectMirror(failure);
        else resolveMirror();
        expect(await result).toBe(
          settlement === 'reject' ? failure : undefined
        );
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
        expect(onUndoHandle).toHaveBeenCalledWith(ordinaryHandle);
        expect(ordinaryHandle.dispose).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    }
  );

  it.each(['mirror', 'ordinary'])(
    'attempts both mixed groups when the %s group fails',
    async (failedId) => {
      const mirror = {
        type: 'reminder',
        id: 'mirror',
        emailFollowup: { threadId: 'thread' },
      } as EntityData;
      const ordinary = { type: 'reminder', id: 'ordinary' } as EntityData;
      const failure = new Error(`${failedId} failed`);
      mocks.mutateAsync.mockImplementationOnce(async () => {
        if (failedId === 'mirror') throw failure;
      });
      mocks.mutateAsync.mockImplementationOnce(async () => {
        if (failedId === 'ordinary') throw failure;
      });
      const { action, dispose } = createAction();
      const onUndoHandle = vi.fn();
      try {
        await expect(
          action.execute([mirror, ordinary], undefined, { onUndoHandle })
        ).rejects.toBe(failure);
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
        expect(mocks.mutateAsync.mock.calls[1][0]).toMatchObject({
          entities: [ordinary],
          onUndoHandle,
        });
        expect(mocks.mutateAsync.mock.calls[0][0]).toMatchObject({
          entities: [mirror],
        });
      } finally {
        dispose();
      }
    }
  );

  it('uses the agent-session entity target while GraphQL Soup is enabled', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: [],
      notificationIds: ['agent-notification'],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReturnValue({
      type: 'agent_session',
      id: 'session-1',
    });
    const session = { type: 'agent_session', id: 'session-1' } as EntityData;
    const { action, dispose } = createAction();

    await action.execute([session]);

    expect(mocks.toNotificationEntityRef).toHaveBeenCalledWith(session);
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        exactNotificationIds: { current: [] },
        notificationEntities: [{ type: 'agent_session', id: 'session-1' }],
        optimisticNotificationIds: ['agent-notification'],
      })
    );
    dispose();
  });

  it('moves list focus without opening the next entity', async () => {
    const { soup } = createSoup();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
    dispose();
  });

  it('uses an explicit navigation handler to open the next entity', async () => {
    const { soup } = createSoup();
    const onNavigate = vi.fn();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup, onNavigate);

    expect(onNavigate).toHaveBeenCalledWith({
      actionId: 'mark-done',
      entity: nextEntity,
    });
    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
    dispose();
  });

  it('passes no target to the navigation handler when no item remains', async () => {
    const { soup, focusSet } = createSoup();
    soup.navigate.peekOffset = vi.fn(() => undefined);
    const onNavigate = vi.fn();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup, onNavigate);

    expect(focusSet).toHaveBeenCalledWith(undefined);
    expect(onNavigate).toHaveBeenCalledWith({
      actionId: 'mark-done',
      entity: undefined,
    });
    dispose();
  });

  it('keeps notification writes ID-scoped while GraphQL Soup is disabled', async () => {
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: ['current'],
      notificationIds: ['notification-1'],
      reminderIds: [],
    });
    const { action, dispose } = createAction();

    await action.execute([currentEntity]);

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        exactNotificationIds: { current: ['notification-1'] },
        notificationEntities: [],
        optimisticNotificationIds: ['notification-1'],
      })
    );
    expect(mocks.toNotificationEntityRef).not.toHaveBeenCalled();
    dispose();
  });

  it('uses entity targets while GraphQL Soup is enabled', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: ['current'],
      notificationIds: ['notification-1'],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReturnValue({
      type: 'email',
      id: 'current',
    });
    const { action, dispose } = createAction();

    await action.execute([currentEntity]);

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        exactNotificationIds: { current: [] },
        notificationEntities: [{ type: 'email', id: 'current' }],
        optimisticNotificationIds: ['notification-1'],
      })
    );
    dispose();
  });

  it('keeps whole-channel inbox writes ID-based to exclude thread rows', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    mocks.splitHandle.content.mockReturnValue({ id: 'home' });
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: [],
      notificationIds: ['channel-notification'],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReturnValue({
      type: 'channel',
      id: 'channel-1',
    });
    const channel = { type: 'channel', id: 'channel-1' } as EntityData;
    const { action, dispose } = createAction();

    await action.execute([channel]);

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        exactNotificationIds: { current: ['channel-notification'] },
        notificationEntities: [],
      })
    );
    dispose();
  });

  it('uses the canonical message entity for inbox channel-thread rows', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    mocks.splitHandle.content.mockReturnValue({ id: 'home' });
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: [],
      notificationIds: ['thread-notification'],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReturnValue({
      type: 'channel_thread',
      id: 'root-message',
      messageId: 'root-message',
    });
    const thread = {
      type: 'channel_thread',
      id: 'root-message',
      messageId: 'root-message',
    } as EntityData;
    const { action, dispose } = createAction();

    await action.execute([thread]);

    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        exactNotificationIds: { current: [] },
        notificationEntities: [
          {
            type: 'channel_thread',
            id: 'root-message',
            messageId: 'root-message',
          },
        ],
      })
    );
    dispose();
  });

  it('applies Undo before its server reply and settles only afterwards', async () => {
    const { dispose } = createAction();
    const variables = {
      emailIds: ['current'],
      exactNotificationIds: { current: ['exact-id'] },
      reminderIds: [],
    };
    const context = {
      applyUndone: vi.fn(),
      reapply: vi.fn(),
      settle: vi.fn(),
      releaseGraphql: vi.fn(),
    };
    const options = mocks.undoableOptionsFactory() as {
      undoFn: (input: typeof variables, ctx: typeof context) => Promise<void>;
    };
    let finish!: () => void;
    mocks.executeMarkEntitiesUndone.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const undo = options.undoFn(variables, context);
    expect(context.applyUndone).toHaveBeenCalledOnce();
    expect(context.settle).not.toHaveBeenCalled();
    finish();
    await undo;
    expect(context.settle).toHaveBeenCalledWith(['exact-id']);
    dispose();
  });

  it('does not pin guessed GraphQL state after a partially failed reversal', async () => {
    const { dispose } = createAction();
    const variables = {
      emailIds: ['current'],
      exactNotificationIds: { current: ['exact-id'] },
      reminderIds: [],
    };
    const context = {
      applyUndone: vi.fn(),
      reapply: vi.fn(),
      settle: vi.fn(),
      releaseGraphql: vi.fn(),
    };
    const options = mocks.undoableOptionsFactory() as {
      undoFn: (input: typeof variables, ctx: typeof context) => Promise<void>;
    };
    mocks.executeMarkEntitiesUndone.mockRejectedValueOnce(
      new Error('partial failure')
    );
    await expect(options.undoFn(variables, context)).rejects.toThrow(
      'partial failure'
    );
    expect(context.reapply).toHaveBeenCalledOnce();
    expect(context.releaseGraphql).toHaveBeenCalledOnce();
    expect(context.settle).not.toHaveBeenCalled();
    dispose();
  });

  it('retains authoritative entity results for exact undo and ID-scoped redo', async () => {
    mocks.graphqlSoupEnabled.mockReturnValue(true);
    mocks.resolveMarkEntitiesDoneVariables.mockReturnValue({
      emailIds: ['current'],
      notificationIds: ['optimistic-notification'],
      reminderIds: [],
    });
    mocks.toNotificationEntityRef.mockReturnValue({
      type: 'email',
      id: 'current',
    });
    mocks.executeMarkEntitiesDone.mockResolvedValue([
      'authoritative-notification',
    ]);
    const { action, dispose } = createAction();
    await action.execute([currentEntity]);
    const variables = mocks.mutateAsync.mock.calls[0]?.[0] as {
      emailIds: string[];
      exactNotificationIds: { current: string[] };
      notificationEntities: Array<{ type: string; id: string }>;
      reminderIds: string[];
    };
    const mutationOptions = mocks.undoableOptionsFactory() as {
      mutationFn: (input: typeof variables) => Promise<void>;
      redoFn: (input: typeof variables, context: undefined) => Promise<void>;
      undoFn: (input: typeof variables, context: undefined) => Promise<void>;
    };

    await mutationOptions.mutationFn(variables);
    expect(mocks.executeMarkEntitiesDone).toHaveBeenCalledWith({
      emailIds: ['current'],
      notificationIds: [],
      notificationEntities: [{ type: 'email', id: 'current' }],
      reminderIds: [],
    });
    expect(variables.exactNotificationIds.current).toEqual([
      'authoritative-notification',
    ]);

    await mutationOptions.undoFn(variables, undefined);
    expect(mocks.executeMarkEntitiesUndone).toHaveBeenCalledWith({
      emailIds: ['current'],
      notificationIds: ['authoritative-notification'],
      reminderIds: [],
    });

    mocks.executeMarkEntitiesDone.mockClear();
    await mutationOptions.redoFn(variables, undefined);
    expect(mocks.executeMarkEntitiesDone).toHaveBeenCalledWith({
      emailIds: ['current'],
      notificationIds: ['authoritative-notification'],
      reminderIds: [],
    });
    dispose();
  });
});
