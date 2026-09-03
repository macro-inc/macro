import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupState } from '../create-soup-state';

const mocks = vi.hoisted(() => ({
  controller: {
    content: vi.fn(() => ({ id: 'other' })),
    isControllerSplit: vi.fn(() => true),
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
  useSplitPanel: () => ({ handle: mocks.controller }),
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

import { makeMarkDoneAction } from './make-mark-done-action';

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

describe('makeMarkDoneAction', () => {
  beforeEach(() => {
    mocks.controller.content.mockReturnValue({ id: 'other' });
    mocks.controller.isControllerSplit.mockReturnValue(true);
    mocks.controller.referredFrom.mockReturnValue(undefined);
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

  it('opens the next focused entity in an engaged Preview Controller', async () => {
    const { soup, focusSet } = createSoup();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup);

    expect(focusSet).toHaveBeenCalledWith('next-row');
    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledWith(
      nextEntity,
      {
        splitHandle: mocks.controller as unknown as SplitHandle,
        mergeHistory: true,
        notificationSource,
      }
    );
    dispose();
  });

  it('does not open the next entity when the split is not a Controller', async () => {
    mocks.controller.isControllerSplit.mockReturnValue(false);
    const { soup } = createSoup();
    const { action, dispose } = createAction();

    await action.executeWithSoup([currentEntity], soup);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
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
    mocks.controller.content.mockReturnValue({ id: 'inbox' });
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
    mocks.controller.content.mockReturnValue({ id: 'inbox' });
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
