import { createCalendarBlockRange } from '@block-calendar/calendar-range';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import {
  getChannelParams,
  navigateToChannelMessage,
} from '@block-channel/utils/link';
import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import type { BlockAlias, BlockName } from '@core/block';
import {
  type ItemLike,
  itemToBlockName,
  resolveBlockAlias,
} from '@core/constant/allBlocks';
import {
  enableCalendarUi,
  enableReminders,
  isFeatureEnabled,
  USE_MACRO_PR_SUMMARY_BLOCK,
} from '@core/constant/featureFlags';
import type { EntityType, NotificationType } from '@core/types';
import { openExternalUrl } from '@core/util/url';
import { getNotificationById } from '@queries/notification/user-notifications';
import { getReminderById } from '@queries/reminders/reminders';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import { isChannelNotification } from './notification-helpers';
import { DefaultNotificationBlockNameResolver } from './notification-resolvers';
import type { NotificationSource } from './notification-source';
import { CHANNEL_EVENT_TYPES } from './notification-source';
import {
  getMostRecentNotification,
  stackNotifications,
} from './notification-stacking';
import type { UnifiedNotification } from './types';

/**
 * Go to location via global block orchestrator.
 */
async function goToLocationInSplit(
  layoutManager: SplitManager,
  type: BlockName | BlockAlias,
  id: string,
  params: Record<string, unknown>
) {
  const orchestrator = layoutManager.getOrchestrator();
  if (!orchestrator) return;
  const handle = await orchestrator.getBlockHandle(id, resolveBlockAlias(type));
  await handle?.goToLocationFromParams(params);
}

/**
 * Opens a split if it is not already open. When `sourceHandle` names the
 * split the navigation originates from and that split is an engaged preview
 * controller, the open is redirected into its viewer split (via the
 * openWithSplit redirect) and never steals the keyboard from the controller.
 */
function openSplitIfNotOpen(
  layoutManager: SplitManager,
  type: BlockName | BlockAlias | 'component',
  id: string,
  options: {
    newSplit?: boolean;
    params?: Record<string, unknown>;
    sourceHandle?: SplitHandle;
  } = {}
) {
  const existing = layoutManager.getSplitByContent(type, id);
  if (existing) {
    const isSourcesViewer =
      options.sourceHandle?.isControllerSplit() &&
      options.sourceHandle.viewerId() === existing.id;
    if (!isSourcesViewer) existing.activate();
  } else {
    layoutManager.openWithSplit(
      { type, id },
      {
        activate: true,
        referredFrom: null,
        preferNewSplit: options.newSplit,
        handle: options.sourceHandle,
      }
    );
  }
  if (options.params && type !== 'component') {
    goToLocationInSplit(layoutManager, type, id, options.params);
  }
}

export function getChannelNotificationParams(
  notification: UnifiedNotification
): { messageId?: string; threadId?: string; params?: Record<string, string> } {
  if (!isChannelNotification(notification)) return {};

  const meta = notification.notification_metadata;
  const { messageId, threadId } = match(meta)
    .with({ tag: 'channel_mention' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId ?? undefined,
    }))
    .with({ tag: 'channel_message_send' }, (m) => ({
      messageId: m.content.messageId,
      threadId: undefined,
    }))
    .with({ tag: 'channel_message_reply' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId,
    }))
    .with({ tag: 'document_mention' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId ?? undefined,
    }))
    .exhaustive();

  const params = messageId ? getChannelParams(messageId, threadId) : undefined;
  return { messageId, threadId, params };
}

/**
 * Opens a channel notification.
 */
async function openChannelNotification(
  notification: UnifiedNotification,
  layoutManager: SplitManager,
  newSplit: boolean = false,
  sourceHandle?: SplitHandle
) {
  const channelId = notification.entity_id;
  const { messageId, threadId } = getChannelNotificationParams(notification);

  if (!messageId) {
    openSplitIfNotOpen(layoutManager, 'channel', channelId, {
      newSplit,
      sourceHandle,
    });
    return;
  }

  const orchestrator = layoutManager.getOrchestrator();
  await navigateToChannelMessage(orchestrator, channelId, messageId, threadId, {
    splitManager: layoutManager,
    preferNewSplit: newSplit,
    sourceHandle,
  });
}

// Minimal entity shape — the live entity from the UI is authoritative when
// available (notification metadata is a snapshot at notification time and may
// lack `subType` for older events).
type NotificationEntityOverride = {
  fileType?: string | null;
  subType?: { type: string } | null;
};

// Resolve the block type for a document notification, honoring `subType` so
// that e.g. a markdown doc with `subType: { type: 'task' }` routes to the
// 'task' block alias instead of raw 'md'. Prefers the live entity's fields
// over the notification-metadata snapshot when provided.
function safeDocumentContentToBlockName(
  content: NotificationEntityOverride,
  entity?: NotificationEntityOverride
) {
  return itemToBlockName({
    type: 'document',
    fileType: entity?.fileType ?? content.fileType ?? undefined,
    subType: entity?.subType ?? content.subType ?? undefined,
  } as ItemLike);
}

function resolveBlockCommentParamName(type: BlockName | BlockAlias) {
  const resolved = resolveBlockAlias(type);
  if (resolved === 'md') return MD_URL_PARAMS.commentId;
  if (resolved === 'pdf') return PDF_URL_PARAMS.annotationId;
}

type NotSupportedError = {
  tag: 'NotSupportedError';
  notificationType: NotificationType;
};

type NotFoundError = {
  tag: 'NotFoundError';
  notificationId: string;
};

type OpenNotificationFromIdError = NotSupportedError | NotFoundError;

function getSupportedHandler(
  notification: UnifiedNotification,
  entity?: NotificationEntityOverride,
  sourceHandle?: SplitHandle
): ((layoutManager: SplitManager, newSplit?: boolean) => Promise<void>) | null {
  const tag = notification.notification_metadata.tag as NotificationType;

  return match(tag)
    .with(
      P.union(...CHANNEL_EVENT_TYPES),
      () =>
        (lm: SplitManager, newSplit: boolean = false) =>
          openChannelNotification(notification, lm, newSplit, sourceHandle)
    )
    .with(
      'ai_response',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'chat', notification.entity_id, {
            newSplit,
            sourceHandle,
          })
    )
    .with('new_email', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'new_email') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'email', meta.content.threadId, {
          newSplit,
          sourceHandle,
        });
      };
    })
    .with(
      'channel_invite',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'channel', notification.entity_id, {
            newSplit,
            sourceHandle,
          })
    )
    .with('invite_to_team', () => null)
    .with(
      'call_started',
      () =>
        async (lm: SplitManager, newSplit: boolean = false) =>
          openSplitIfNotOpen(lm, 'channel', notification.entity_id, {
            newSplit,
            sourceHandle,
          })
    )
    .with('task_assigned', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'task_assigned') return null;
      return async (lm: SplitManager, newSplit: boolean = false) => {
        openSplitIfNotOpen(lm, 'task', meta.content.taskId, {
          newSplit,
          sourceHandle,
        });
      };
    })
    .with(P.union(...GITHUB_EVENT_TYPES), () => {
      const meta = notification.notification_metadata;
      if (
        meta.tag !== 'github_pr_status_changed' &&
        meta.tag !== 'github_review_requested' &&
        meta.tag !== 'github_pr_comment' &&
        meta.tag !== 'github_pr_mention' &&
        meta.tag !== 'github_pr_review' &&
        meta.tag !== 'github_pr_check_run'
      ) {
        return null;
      }
      return async (lm: SplitManager, newSplit: boolean = false) => {
        if (USE_MACRO_PR_SUMMARY_BLOCK) {
          openSplitIfNotOpen(lm, 'pr', notification.entity_id, {
            newSplit,
            sourceHandle,
          });
          return;
        }

        let url = meta.content.url;
        if (meta.tag === 'github_pr_check_run') {
          url = meta.content.checkUrl || meta.content.url;
        }

        openExternalUrl(url);
      };
    })
    .with('mentioned_in_document_comment', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'mentioned_in_document_comment') return null;

      const blockName = safeDocumentContentToBlockName(meta.content, entity);
      const commentParamName = resolveBlockCommentParamName(blockName);
      const params = commentParamName
        ? {
            [commentParamName]: meta.content.commentId.toString(),
          }
        : undefined;

      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(lm, blockName, notification.entity_id, {
          newSplit,
          params,
          sourceHandle,
        });
    })
    .with('replied_to_document_comment_thread', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'replied_to_document_comment_thread') return null;

      const blockName = safeDocumentContentToBlockName(meta.content, entity);
      const commentParamName = resolveBlockCommentParamName(blockName);
      const params = commentParamName
        ? {
            [commentParamName]: meta.content.commentId.toString(),
          }
        : undefined;

      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(lm, blockName, notification.entity_id, {
          newSplit,
          params,
          sourceHandle,
        });
    })
    .with('commented_on_document', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'commented_on_document') return null;

      const blockName = safeDocumentContentToBlockName(meta.content, entity);
      const commentParamName = resolveBlockCommentParamName(blockName);
      const params = commentParamName
        ? {
            [commentParamName]: meta.content.commentId.toString(),
          }
        : undefined;

      return async (lm: SplitManager, newSplit: boolean = false) =>
        openSplitIfNotOpen(lm, blockName, notification.entity_id, {
          newSplit,
          params,
          sourceHandle,
        });
    })
    .with('reminder', () => {
      // The notification points at the reminder itself, so there is nothing to
      // open until the reminder is fetched and its referenced entity read. A
      // standalone reminder references nothing and opens nothing.
      return async (lm: SplitManager, newSplit: boolean = false) => {
        // A reminder created before the flag closed still has a live
        // notification; opening it would reach reminder surfaces the user is
        // no longer meant to have.
        if (!isFeatureEnabled(enableReminders)) return;
        const reminder = await getReminderById(notification.entity_id);
        const entityType = reminder?.entityType;
        const entityId = reminder?.entityId;
        if (!entityType || !entityId) return;

        const blockName = await DefaultNotificationBlockNameResolver(
          entityId,
          entityType as EntityType
        );
        if (!blockName) return;

        openSplitIfNotOpen(lm, blockName, entityId, {
          newSplit,
          sourceHandle,
        });
      };
    })
    .with('calendar_event_reminder', () => {
      const meta = notification.notification_metadata;
      if (meta.tag !== 'calendar_event_reminder') return null;

      return async (lm: SplitManager, newSplit: boolean = false) => {
        // A reminder delivered before the flag closed still has a live
        // notification; opening it must not reach a surface the user is no
        // longer meant to have.
        if (!isFeatureEnabled(enableCalendarUi)) return;
        const content = meta.content;
        const time = content.startsAt
          ? {
              kind: 'timed' as const,
              startsAt: content.startsAt,
              endsAt: content.endsAt ?? undefined,
            }
          : content.startDate
            ? { kind: 'allDay' as const, startDate: content.startDate }
            : undefined;
        const range = time ? createCalendarBlockRange(time) : undefined;
        openSplitIfNotOpen(lm, 'calendar', CALENDAR_BLOCK_ID, {
          newSplit,
          sourceHandle,
          params: {
            eventId: content.eventId,
            occurrenceKey: content.occurrenceKey,
            range,
          },
        });
      };
    })
    .with('inbox_reauth_required', () => null)
    .exhaustive();
}

/**
 * Opens the notification given the layout manager.
 * Some notifications are not supported and will return an error.
 */
export function openNotification(
  notification: UnifiedNotification,
  layoutManager: SplitManager,
  newSplit: boolean = false,
  entity?: NotificationEntityOverride,
  /**
   * The split this navigation originates from (e.g. the list whose row was
   * clicked). Routes the open through that split's preview viewer when its
   * preview mode is engaged.
   */
  sourceHandle?: SplitHandle
): ResultAsync<void, NotSupportedError> {
  const handler = getSupportedHandler(notification, entity, sourceHandle);
  if (!handler) {
    return errAsync({
      tag: 'NotSupportedError',
      notificationType: notification.notification_metadata.tag,
    });
  }
  return ResultAsync.fromSafePromise(handler(layoutManager, newSplit));
}

export function openSingleStackNotification(
  notifications: UnifiedNotification[],
  layoutManager: SplitManager,
  newSplit: boolean = false,
  sourceHandle?: SplitHandle
): boolean {
  const stacks = stackNotifications(notifications);
  if (stacks.length !== 1) return false;
  const mostRecent = getMostRecentNotification(stacks[0]!);
  openNotification(
    mostRecent,
    layoutManager,
    newSplit,
    undefined,
    sourceHandle
  );
  return true;
}

export function openNotificationFromId(
  notificationId: string,
  layoutManager: SplitManager,
  notificationSource: NotificationSource
): ResultAsync<void, OpenNotificationFromIdError> {
  // Check notification source first
  const cached = notificationSource
    .notifications()
    .find((n) => n.id === notificationId);
  if (cached) {
    return openNotification(cached, layoutManager);
  }

  // Fetch if not in notification source
  return ResultAsync.fromSafePromise(
    getNotificationById(notificationId)
  ).andThen((unified) => {
    if (!unified) {
      const err: NotFoundError = { tag: 'NotFoundError', notificationId };
      return errAsync(err);
    }
    return openNotification(unified, layoutManager);
  });
}
