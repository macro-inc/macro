import { openCalendarView } from '@app/features/calendar-view/calendar-navigation';
import { createCalendarRange } from '@app/features/calendar-view/calendar-range';
import {
  getChannelParams,
  navigateToChannelMessage,
} from '@block-channel/utils/link';
import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import type { BlockAlias, BlockName } from '@core/block';
import { resolveBlockAlias } from '@core/constant/allBlocks';
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
import {
  getDocumentCommentLocation,
  type NotificationEntityOverride,
} from './document-comment-location';
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

/** Opens or activates the requested content from the source split. */
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
    existing.activate();
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

  return (
    match(tag)
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
      // Every agent-session kind opens the session itself: the chip in the
      // thread is one surface for it, and a session prompted from the split
      // has no chip at all.
      .with(
        P.union(
          'agent_session_settled',
          'agent_session_waiting_for_input',
          'agent_session_mentioned'
        ),
        () => {
          const meta = notification.notification_metadata;
          if (
            meta.tag !== 'agent_session_settled' &&
            meta.tag !== 'agent_session_waiting_for_input' &&
            meta.tag !== 'agent_session_mentioned'
          ) {
            return null;
          }
          return async (lm: SplitManager, newSplit: boolean = false) => {
            openSplitIfNotOpen(lm, 'agent', meta.content.sessionId, {
              newSplit,
              sourceHandle,
            });
          };
        }
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
      .with(
        P.union(
          'mentioned_in_document_comment',
          'replied_to_document_comment_thread',
          'commented_on_document'
        ),
        () => {
          const location = getDocumentCommentLocation(notification, entity);
          if (!location) return null;

          return async (lm: SplitManager, newSplit: boolean = false) =>
            openSplitIfNotOpen(lm, location.blockName, notification.entity_id, {
              newSplit,
              params: location.params,
              sourceHandle,
            });
        }
      )
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
          const range = time ? createCalendarRange(time) : undefined;
          openCalendarView(
            {
              eventId: content.eventId,
              occurrenceKey: content.occurrenceKey,
              range,
            },
            {
              manager: lm,
              handle: sourceHandle,
              openInNewSplit: newSplit,
            }
          );
        };
      })
      .with('inbox_reauth_required', () => null)
      .exhaustive()
  );
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
   * clicked).
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
