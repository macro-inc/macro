import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import { CHANNEL_ACTION_VIEW_CONTEXT } from '@channel/Channel/channel-actions';
import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: () => undefined,
    canAppendSplit: () => true,
  }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.source,
}));
vi.mock('../entity-appearance/queries/access', () => ({
  useAppearanceEditAccess: () => () => false,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
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

beforeEach(() => mocks.open.mockClear());

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
});
