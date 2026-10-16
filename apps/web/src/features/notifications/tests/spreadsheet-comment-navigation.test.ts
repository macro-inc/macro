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
import { openShareModal } from '@core/component/TopBar/shareModal';
import { isFeatureEnabled } from '@core/constant/featureFlags';
import { fetchAccessRequestState } from '@queries/access-requests/requests';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import { expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';

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
  enableProjects: { key: 'enable-projects' },
  enableReminders: false,
  isFeatureEnabled: vi.fn(),
  USE_MACRO_PR_SUMMARY_BLOCK: true,
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@queries/notification/user-notifications', () => ({
  getNotificationById: vi.fn(),
}));
vi.mock('@queries/reminders/reminders', () => ({ getReminderById: vi.fn() }));
vi.mock('@core/component/TopBar/shareModal', () => ({
  openShareModal: vi.fn(),
}));
vi.mock('@queries/access-requests/requests', () => ({
  fetchAccessRequestState: vi.fn(),
}));
vi.mock('@queries/storage/document-metadata', () => ({
  fetchDocumentMetadata: vi.fn(),
}));
vi.mock('../notification-resolvers', () => ({
  DefaultNotificationBlockNameResolver: vi.fn(),
}));

import { openNotification } from '../notification-navigation';

type RecordedSpan = {
  name: string;
  parent?: string;
  attrs: Record<string, unknown>;
  errors: unknown[];
  finished: boolean;
};
type ObservedSpan = {
  setAttr(key: string, value: unknown): void;
  error(error: unknown): void;
  run<T>(operation: () => T): T;
  span<T>(
    name: string,
    operation: (span: ObservedSpan) => Promise<T>
  ): Promise<T>;
};
const traces = vi.hoisted(() => {
  const spans: RecordedSpan[] = [];
  return spans;
});
vi.mock('@macro-inc/observability', () => {
  async function runSpan<T>(
    name: string,
    parent: string | undefined,
    operation: (span: ObservedSpan) => Promise<T>
  ): Promise<T> {
    const record: RecordedSpan = {
      name,
      parent,
      attrs: {},
      errors: [],
      finished: false,
    };
    traces.push(record);
    try {
      return await operation({
        setAttr: (key, value) => {
          record.attrs[key] = value;
        },
        error: (error) => {
          record.errors.push(error);
        },
        run: (operation) => operation(),
        span: (child, operation) => runSpan(child, name, operation),
      });
    } finally {
      record.finished = true;
    }
  }
  return {
    Telemetry: {
      span: <T>(name: string, operation: (span: ObservedSpan) => Promise<T>) =>
        runSpan(name, undefined, operation),
    },
  };
});

it.each([null, 'view'] as const)(
  'opens request review with stored document metadata when file access is %s',
  async (accessLevel) => {
    traces.splice(0);
    vi.mocked(openShareModal).mockClear();
    vi.mocked(fetchDocumentMetadata)
      .mockReset()
      .mockRejectedValue(new Error('403 Forbidden'));
    vi.mocked(fetchAccessRequestState).mockResolvedValue({
      canReview: true,
      accessLevel,
      owner: 'macro|owner@macro.com',
      supportedLevels: ['view', 'comment', 'edit'],
      requests: [],
      pendingCount: 1,
    });
    const activate = vi.fn();
    const layout = { getSplitByContent: vi.fn(() => ({ activate })) };
    const id = '01a140ad-06d5-7791-8b68-bc128654bbba';
    const notification: UnifiedNotification = {
      id: 'notification',
      entity_id: id,
      entity_type: 'document',
      created_at: '2026-10-15T00:00:00Z',
      updated_at: '2026-10-15T00:00:00Z',
      notification_event_type: 'entity_access_requested',
      state: 'unseen',
      sent: true,
      notification_metadata: {
        tag: 'entity_access_requested',
        content: {
          requestId: 'request',
          revision: 1,
          entityName: 'Private document',
          fileType: 'md',
          accessLevel: 'view',
        },
      },
    };
    const result = await openNotification(
      notification,
      layout as unknown as SplitManager
    );
    expect(result.isOk()).toBe(true);
    expect(layout.getSplitByContent).toHaveBeenCalledWith('md', id);
    expect(activate).toHaveBeenCalledOnce();
    expect(openShareModal).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        blockAlias: 'md',
        name: 'Private document',
      })
    );
    expect(fetchDocumentMetadata).toHaveBeenCalledTimes(
      accessLevel === null ? 0 : 1
    );
    expect(traces.map(({ name, parent }) => ({ name, parent }))).toEqual([
      { name: 'access_requests.notification.open', parent: undefined },
      {
        name: 'access_requests.notification.state',
        parent: 'access_requests.notification.open',
      },
      {
        name: 'access_requests.notification.metadata',
        parent: 'access_requests.notification.open',
      },
    ]);
    expect(traces[0].attrs).toMatchObject({
      'entity.id': id,
      'notification.id': 'notification',
      'access_request.id': 'request',
      'access_requests.outcome': 'navigation_requested',
    });
    expect(traces[2].attrs['access_requests.outcome']).toBe(
      accessLevel === null ? 'skipped_no_access' : 'fallback'
    );
    expect(traces[2].errors).toHaveLength(accessLevel === null ? 0 : 1);
    expect(traces.every((span) => span.finished)).toBe(true);
    expect(JSON.stringify(traces)).not.toContain('Private document');
    expect(JSON.stringify(traces)).not.toContain('macro|owner@macro.com');
  }
);

it.each([
  'commented_on_document',
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
] as const)(
  'opens %s at the spreadsheet comment, including an already open sheet',
  async (tag) => {
    const commentId = '019f862a-84b6-7f00-8000-000000000042';
    const threadId = '019f862a-84b6-7f00-8000-000000000007';
    const navigate = vi.fn();
    const open = vi.fn();
    const activate = vi.fn();
    const layout = {
      getSplitByContent: vi.fn(() => undefined as unknown),
      openWithSplit: open,
      getOrchestrator: () => ({
        getBlockHandle: async () => ({ goToLocationFromParams: navigate }),
      }),
    };
    const notification = {
      entity_id: 'sheet-doc',
      notification_metadata: {
        tag,
        content: { fileType: 'spreadsheet', commentId, threadId },
      },
    } as UnifiedNotification;
    const result = await openNotification(
      notification,
      layout as unknown as SplitManager
    );
    expect(result.isOk()).toBe(true);
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ comment_id: commentId })
    );
    expect(open).toHaveBeenCalledWith(
      { type: 'spreadsheet', id: 'sheet-doc' },
      expect.anything()
    );
    layout.getSplitByContent.mockReturnValue({ activate });
    open.mockClear();
    navigate.mockClear();
    await openNotification(notification, layout as unknown as SplitManager);
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ comment_id: commentId })
    );
    expect(activate).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  }
);

it('opens a project notification at the exact discussion in a native component view', async () => {
  vi.mocked(isFeatureEnabled).mockReturnValue(true);
  const projectId = '01992d2f-8444-7000-8000-000000000001';
  const messageId = '01992d2f-8444-7000-8000-000000000002';
  const open = vi.fn();
  const activate = vi.fn();
  const layout = {
    getSplitByContent: vi.fn(() => undefined as unknown),
    openWithSplit: open,
  };
  const notification = {
    entity_id: projectId,
    entity_type: 'initiative',
    notification_metadata: {
      tag: 'initiative_discussion',
      content: { messageId },
    },
  } as UnifiedNotification;
  const target = {
    type: 'component',
    id: `initiative-view~${projectId}~overview~${messageId}`,
  };
  const result = await openNotification(
    notification,
    layout as unknown as SplitManager,
    true
  );
  expect(result.isOk()).toBe(true);
  expect(open).toHaveBeenCalledWith(
    target,
    expect.objectContaining({ preferNewSplit: true })
  );
  layout.getSplitByContent.mockReturnValue({ activate });
  open.mockClear();
  await openNotification(notification, layout as unknown as SplitManager);
  expect(activate).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
});

it('does not open project notifications when the rollout is disabled', async () => {
  vi.mocked(isFeatureEnabled).mockReturnValue(false);
  const open = vi.fn();
  const activate = vi.fn();
  const layout = {
    getSplitByContent: vi.fn(() => ({ activate })),
    openWithSplit: open,
  };
  const notification = {
    entity_id: 'project',
    entity_type: 'initiative',
    notification_metadata: {
      tag: 'initiative_discussion',
      content: { messageId: 'discussion' },
    },
  } as UnifiedNotification;
  const result = await openNotification(
    notification,
    layout as unknown as SplitManager
  );
  expect(result.isErr()).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
});
