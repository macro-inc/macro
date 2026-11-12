import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { CHANNEL_ACTION_VIEW_CONTEXT } from '@channel/Channel/channel-actions';
import {
  consumeOpenInNewTabIntent,
  disarmOpenInNewTabIntent,
} from '@components/app/tab-layout/open-in-tab-intent';
import type { EntityData } from '@entity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSoupEntityActions } from './createSoupEntityActions';

const mocks = vi.hoisted(() => ({
  action: () => ({ canExecute: () => false, execute: () => {} }),
  open: vi.fn(
    async (
      _entity: unknown,
      _options: { channelNavigation?: string; channelReadScope?: string }
    ) => {}
  ),
  source: {},
  existingSplit: vi.fn<() => { id: string } | undefined>(() => undefined),
  tabManager: vi.fn<() => object | undefined>(() => undefined),
  openProjectAction: vi.fn(),
  projectsEnabled: true,
}));

vi.mock('@app/features/next-soup/actions', () => ({
  emailSenderBucket: () => undefined,
  makeArchiveSessionAction: mocks.action,
  makeBlockSenderAction: mocks.action,
  makeChannelPictureAction: mocks.action,
  makeCopyAction: mocks.action,
  makeCopyBranchNameAction: mocks.action,
  makeCopyEntityIdAction: mocks.action,
  makeCopyLinkAction: mocks.action,
  makeCreateReminderAction: mocks.action,
  makeDeleteAction: mocks.action,
  makeDownloadAction: mocks.action,
  makeFavoriteAction: mocks.action,
  makeGithubLinkAction: mocks.action,
  makeMarkDoneAction: mocks.action,
  makeMarkNotDoneAction: mocks.action,
  makeMarkNotificationsReadAction: mocks.action,
  makeMarkReadAction: mocks.action,
  makeMarkSenderNoiseAction: mocks.action,
  makeMarkSenderSignalAction: mocks.action,
  makeMarkUnreadAction: mocks.action,
  makeMoveToProjectAction: mocks.action,
  makeMuteAction: mocks.action,
  makeRemoveFromProjectAction: mocks.action,
  makeRenameAction: mocks.action,
  makeShareAction: mocks.action,
}));
vi.mock('@app/features/projects/project-entity-actions', () => ({
  openProjectEntityAction: mocks.openProjectAction,
}));
vi.mock('@app/features/crm/crm-action-items', () => ({
  createCrmEntityActionItems: () => () => [],
}));
vi.mock('@app/features/next-soup/utils', () => ({
  markRowNotificationsSeenOnOpen: vi.fn(),
  openEntityInSplitFromUnifiedList: mocks.open,
  restoreSoupFocus: vi.fn(),
}));
vi.mock('@app/features/property/editor/hooks/useAllProperties', () => ({
  useAllProperties: () => () => [],
}));
vi.mock('@app/features/property/editor/state/propertyEditor', () => ({
  openPropertyEditor: vi.fn(),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.projectsEnabled }),
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: mocks.existingSplit,
    canAppendSplit: () => true,
  }),
}));
vi.mock('@app/signal/tabLayout', () => ({
  globalTabManager: mocks.tabManager,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@queries/team/teams', () => ({ useIsTeamAdmin: () => () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

const channel = {
  type: 'channel',
  id: 'channel',
  name: 'General',
  unreadNotifications: [],
} as unknown as EntityData;

const openFromMenu = async (viewContext: EntityActionViewContext) => {
  const { buildActionGroups } = createSoupEntityActions();
  const item = buildActionGroups({} as EntityActionListState, [channel], {
    viewContext,
  })
    .flatMap((group) => group.items)
    .find(({ id }) => id === 'open-in-split');
  await item?.onClick();
};

beforeEach(() => {
  mocks.open.mockReset();
  mocks.existingSplit.mockReset();
  mocks.tabManager.mockReset();
  mocks.openProjectAction.mockReset();
  mocks.projectsEnabled = true;
});

afterEach(() => disarmOpenInNewTabIntent());

describe('Open in new split on a conversation', () => {
  it('opens a channel rail row at latest with its top-level read scope', async () => {
    await openFromMenu(CHANNEL_ACTION_VIEW_CONTEXT);

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      channel,
      expect.objectContaining({
        openInNewSplit: true,
        notificationSource: mocks.source,
        channelNavigation: 'latest',
        channelReadScope: 'top-level',
      })
    );
  });

  it('keeps a row from another list aimed at its notification', async () => {
    await openFromMenu({
      supportsMarkDone: true,
      supportsOpenInNewSplit: true,
      senderBucket: undefined,
    });

    expect(mocks.open).toHaveBeenCalledOnce();
    const options = mocks.open.mock.calls[0]?.[1];
    expect(options?.channelNavigation).toBeUndefined();
    expect(options?.channelReadScope).toBeUndefined();
  });

  it('does not duplicate a split opened after the menu was built', async () => {
    const { buildActionGroups } = createSoupEntityActions();
    const action = buildActionGroups({} as EntityActionListState, [channel], {
      viewContext: CHANNEL_ACTION_VIEW_CONTEXT,
    })
      .flatMap((group) => group.items)
      .find(({ id }) => id === 'open-in-split');

    expect(action).toBeDefined();
    mocks.existingSplit.mockReturnValue({ id: 'existing' });
    await action?.onClick();

    expect(mocks.open).not.toHaveBeenCalled();
  });
});

describe('Open in new tab on a conversation', () => {
  it.each([true, false])(
    'opens another tab when the channel is open before the menu: %s',
    async (alreadyOpen) => {
      mocks.tabManager.mockReturnValue({});
      if (alreadyOpen) {
        mocks.existingSplit.mockReturnValue({ id: 'existing' });
      }
      mocks.open.mockImplementationOnce(async () => {
        expect(consumeOpenInNewTabIntent()).toEqual({ activate: true });
      });
      const { buildActionGroups } = createSoupEntityActions();
      const action = buildActionGroups({} as EntityActionListState, [channel], {
        viewContext: CHANNEL_ACTION_VIEW_CONTEXT,
      })
        .flatMap((group) => group.items)
        .find(({ id }) => id === 'open-in-tab');

      expect(action).toBeDefined();
      mocks.existingSplit.mockReturnValue({ id: 'existing' });
      await action?.onClick();

      expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
        channel,
        expect.objectContaining({
          openInNewSplit: false,
          channelNavigation: 'latest',
          channelReadScope: 'top-level',
        })
      );
    }
  );
});

const project = (id: string, ownerId: string) =>
  ({ type: 'initiative', id, name: `Project ${id}`, ownerId }) as EntityData;

const clearSelection = vi.fn();
const menuItems = (entities: EntityData[]) =>
  createSoupEntityActions()
    .buildActionGroups(
      {
        selection: { clear: clearSelection },
      } as unknown as EntityActionListState,
      entities,
      {
        viewContext: {
          supportsMarkDone: false,
          supportsOpenInNewSplit: true,
          senderBucket: undefined,
        },
      }
    )
    .flatMap((group) => group.items);

describe('Project rows', () => {
  it('offers an owned project its rename, share and delete actions', async () => {
    const items = menuItems([project('a', 'user')]);

    expect(items.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['open-in-split', 'rename', 'share', 'delete'])
    );
    await items.find(({ id }) => id === 'rename')?.onClick();
    await items.find(({ id }) => id === 'share')?.onClick();
    await items.find(({ id }) => id === 'delete')?.onClick();

    expect(mocks.openProjectAction.mock.calls).toEqual([
      [{ kind: 'rename', id: 'a', name: 'Project a' }],
      [{ kind: 'share', id: 'a' }],
      [{ kind: 'delete', ids: ['a'] }, { onDeleted: expect.any(Function) }],
    ]);
  });

  it("offers only sharing on someone else's project", () => {
    const ids = menuItems([project('a', 'someone')]).map(({ id }) => id);

    expect(ids).toContain('share');
    expect(ids).not.toContain('rename');
    expect(ids).not.toContain('delete');
  });

  it('deletes several owned projects together and drops single-project actions', async () => {
    const items = menuItems([project('a', 'user'), project('b', 'user')]);

    expect(items.map(({ id }) => id)).toEqual(['delete']);
    await items[0]?.onClick();

    expect(mocks.openProjectAction).toHaveBeenCalledExactlyOnceWith(
      { kind: 'delete', ids: ['a', 'b'] },
      { onDeleted: expect.any(Function) }
    );
    clearSelection.mockClear();
    mocks.openProjectAction.mock.calls[0]?.[1]?.onDeleted(['a']);
    expect(clearSelection).toHaveBeenCalledOnce();
  });

  it('offers no project actions while projects are off or loading', () => {
    mocks.projectsEnabled = false;
    const ids = menuItems([project('a', 'user')]).map(({ id }) => id);

    expect(ids).not.toContain('rename');
    expect(ids).not.toContain('share');
    expect(ids).not.toContain('delete');
  });

  it('keeps project actions off a selection mixing projects with other items', () => {
    expect(menuItems([project('a', 'user'), channel])).toEqual([]);
  });
});
