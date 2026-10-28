vi.mock('../notification-helpers', () => ({
  isChannelNotification: () => false,
}));
vi.mock('../notification-source', () => ({
  CHANNEL_EVENT_TYPES: [
    'channel_mention',
    'channel_message_send',
    'channel_message_reply',
    'document_mention',
  ],
}));
vi.mock('../notification-stacking', () => ({
  getMostRecentNotification: vi.fn(),
  stackNotifications: vi.fn(),
}));

import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { afterEach, expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';

const fixture = vi.hoisted(() => ({ touch: false }));

vi.mock('@app/features/calendar-view/calendar-range', () => ({
  createCalendarRange: vi.fn(),
}));
vi.mock('@app/features/calendar-view/calendar-navigation', () => ({
  openCalendarView: vi.fn(),
}));
vi.mock('@block-channel/utils/link', () => ({
  getChannelParams: vi.fn(),
  navigateToChannelMessage: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (value: { fileType: string }) => value.fileType,
  resolveBlockAlias: (type: string) => (type === 'task' ? 'md' : type),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCalendarUi: false,
  enableReminders: false,
  isFeatureEnabled: vi.fn(),
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixture.touch,
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById: vi.fn(),
}));
vi.mock('@queries/reminders/reminders', () => ({ getReminderById: vi.fn() }));
vi.mock('../notification-resolvers', () => ({
  DefaultNotificationBlockNameResolver: vi.fn(),
}));

import { openNotification } from '../notification-navigation';

afterEach(() => {
  fixture.touch = false;
});

const records = [
  ['crm_company', 'company'],
  ['crm_contact', 'contact'],
] as const;

function setup(entityType: (typeof records)[number][0]) {
  const navigate = vi.fn();
  const open = vi.fn(() => ({ status: 'opened' }));
  const layout = {
    getSplitByContent: vi.fn(() => undefined as unknown),
    openWithSplit: open,
    getOrchestrator: () => ({
      getBlockHandle: async () => ({ goToLocationFromParams: navigate }),
    }),
  };
  const notification = {
    entity_id: 'record',
    entity_type: entityType,
    notification_metadata: {
      tag: 'crm_discussion',
      content: { messageId: 'message', threadId: 'root', reason: 'reply' },
    },
  } as UnifiedNotification;
  return {
    navigate,
    open,
    run: () =>
      openNotification(notification, layout as unknown as SplitManager),
  };
}

it.each(records)(
  'opens a %s discussion notification in Customers at its message on desktop',
  async (entityType, recordType) => {
    const { navigate, open, run } = setup(entityType);

    const result = await run();

    expect(result.isOk()).toBe(true);
    expect(open).toHaveBeenCalledWith(
      {
        type: 'component',
        id: 'companies',
        entryMetadata: {
          route: {
            matches: [
              { id: 'app', params: {} },
              { id: 'view-companies', params: {} },
              {
                id: 'companies-record',
                params: { recordType, recordId: 'record' },
              },
            ],
          },
          search: {
            // A contact opens from People.
            ...(recordType === 'contact' ? { crm: { tab: ['people'] } } : {}),
            'crm-record': {
              commentId: ['message'],
              seek: [expect.any(String)],
            },
          },
        },
      },
      expect.objectContaining({ allowDuplicate: true })
    );
    expect(navigate).not.toHaveBeenCalled();
  }
);

it.each(records)(
  'opens a %s discussion notification on its own page at its message on touch',
  async (entityType, blockName) => {
    fixture.touch = true;
    const { navigate, open, run } = setup(entityType);

    const result = await run();

    expect(result.isOk()).toBe(true);
    expect(open).toHaveBeenCalledWith(
      { type: blockName, id: 'record' },
      expect.anything()
    );
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ comment_id: 'message' })
    );
  }
);
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchChannelTarget: vi.fn(async () => {}),
}));
