import { openCalendarView } from '@app/features/calendar-view/calendar-navigation';
import { createCalendarRange } from '@app/features/calendar-view/calendar-range';
import { crmRecordContent } from '@app/features/crm/crm-hosted-content';
import {
  getChannelParams,
  navigateToChannelMessage,
} from '@block-channel/utils/link';
import { prefetchChannelTarget } from '@channel/queries/prefetch-channel-target';
import { contentReference } from '@components/app/split-layout/content-reference';
import type {
  OpenSplitResult,
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import type { BlockAlias, BlockName } from '@core/block';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { itemToBlockName, resolveBlockAlias } from '@core/constant/allBlocks';
import {
  enableCalendarUi,
  enableProjects,
  isFeatureEnabled,
  USE_MACRO_PR_SUMMARY_BLOCK,
} from '@core/constant/featureFlags';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { NotificationType } from '@core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import { openExternalUrl } from '@core/util/url';
import { Telemetry } from '@macro-inc/observability';
import { getNotificationById } from '@queries/notification/user-notifications';
import type { PushNotificationNavigation } from '@service-notification/generated/schemas/pushNotificationNavigation';
import { errAsync, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { shareEntity } from '../access-requests/core/types';
import { projectRouteId } from '../projects/core/route';
import {
  getDocumentCommentLocation,
  type NotificationEntityOverride,
} from './document-comment-location';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import { isChannelNotification } from './notification-helpers';
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
    onApplied?: VoidFunction;
  } = {}
) {
  let onApplied = options.onApplied;
  const reportApplied = () => {
    const callback = onApplied;
    onApplied = undefined;
    callback?.();
  };
  const reportImmediateResult = (result: OpenSplitResult | undefined) => {
    if (!result) return;
    if (result.status === 'opened' || result.status === 'reused') {
      reportApplied();
    }
  };
  const existing = layoutManager.getSplitByContent(type, id);
  if (existing) {
    existing.activate();
    reportApplied();
  } else {
    const result = layoutManager.openWithSplit(contentReference(type, id), {
      activate: true,
      referredFrom: null,
      preferNewSplit: options.newSplit,
      handle: options.sourceHandle,
      ...(options.onApplied ? { onApplied: reportApplied } : {}),
    });
    reportImmediateResult(result);
  }
  if (options.params && type !== 'component') {
    goToLocationInSplit(layoutManager, type, id, options.params).catch(
      (error) => Telemetry.error(error, { surface: 'notification-navigation' })
    );
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
      threadId: m.content.messageId,
    }))
    .with({ tag: 'channel_message_reaction' }, (m) => ({
      messageId: m.content.messageId,
      threadId: m.content.threadId ?? undefined,
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
  sourceHandle?: SplitHandle,
  onApplied?: VoidFunction
) {
  const channelId = notification.entity_id;
  const { messageId, threadId } = getChannelNotificationParams(notification);

  if (!messageId) {
    openSplitIfNotOpen(layoutManager, 'channel', channelId, {
      newSplit,
      sourceHandle,
      onApplied,
    });
    return;
  }

  const orchestrator = layoutManager.getOrchestrator();
  await navigateToChannelMessage(orchestrator, channelId, messageId, threadId, {
    splitManager: layoutManager,
    preferNewSplit: newSplit,
    sourceHandle,
    ...(onApplied ? { onApplied } : {}),
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

type NavigationDeferredError = {
  tag: 'NavigationDeferredError';
  notificationId: string;
};

type OpenNotificationFromIdError =
  | NotSupportedError
  | NotFoundError
  | NavigationDeferredError;

function getSupportedHandler(
  notification: UnifiedNotification,
  entity?: NotificationEntityOverride,
  sourceHandle?: SplitHandle,
  onApplied?: VoidFunction
): ((layoutManager: SplitManager, newSplit?: boolean) => Promise<void>) | null {
  const tag = notification.notification_metadata.tag as NotificationType;

  return (
    match(tag)
      .with(
        P.union(...CHANNEL_EVENT_TYPES),
        () =>
          (lm: SplitManager, newSplit: boolean = false) =>
            openChannelNotification(
              notification,
              lm,
              newSplit,
              sourceHandle,
              onApplied
            )
      )
      .with(
        'ai_response',
        () =>
          async (lm: SplitManager, newSplit: boolean = false) =>
            openSplitIfNotOpen(lm, 'chat', notification.entity_id, {
              newSplit,
              sourceHandle,
              onApplied,
            })
      )
      .with('new_email', () => {
        const meta = notification.notification_metadata;
        if (meta.tag !== 'new_email') return null;
        return async (lm: SplitManager, newSplit: boolean = false) => {
          openSplitIfNotOpen(lm, 'email', meta.content.threadId, {
            newSplit,
            sourceHandle,
            onApplied,
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
              onApplied,
            })
      )
      .with('entity_access_requested', 'entity_access_granted', () => {
        const meta = notification.notification_metadata;
        if (
          meta.tag !== 'entity_access_requested' &&
          meta.tag !== 'entity_access_granted'
        )
          return null;
        const target = shareEntity(
          notification.entity_type,
          notification.entity_id
        );
        if (!target) return null;
        return async (lm: SplitManager, newSplit = false) =>
          Telemetry.span('access_requests.notification.open', async (span) => {
            span.setAttr('entity.id', target.entityId);
            span.setAttr('entity.type', target.entityType);
            span.setAttr('notification.id', notification.id);
            span.setAttr('notification.type', meta.tag);
            span.setAttr('access_request.id', meta.content.requestId);
            try {
              const [{ fetchAccessRequestState }, { openShareModal }] =
                await Promise.all([
                  import('@queries/access-requests/requests'),
                  import('@core/component/TopBar/shareModal'),
                ]);
              const state = await span.span(
                'access_requests.notification.state',
                async (phase) => {
                  try {
                    const state = await fetchAccessRequestState(target);
                    phase.setAttr('access_requests.outcome', 'loaded');
                    return state;
                  } catch (error) {
                    phase.setAttr('access_requests.outcome', 'error');
                    phase.error('Access-request state could not be loaded');
                    throw error;
                  }
                }
              );
              const document =
                target.entityType === 'document'
                  ? await span.span(
                      'access_requests.notification.metadata',
                      async (phase) => {
                        if (state.accessLevel == null) {
                          phase.setAttr(
                            'access_requests.outcome',
                            'skipped_no_access'
                          );
                          return;
                        }
                        const result = await catchToResult(async () =>
                          (
                            await import('@queries/storage/document-metadata')
                          ).fetchDocumentMetadata(target.entityId)
                        );
                        phase.setAttr(
                          'access_requests.outcome',
                          result.isOk() ? 'loaded' : 'fallback'
                        );
                        if (result.isErr()) {
                          phase.error(
                            'Document metadata unavailable; using notification routing'
                          );
                          return;
                        }
                        return result.value;
                      }
                    )
                  : undefined;
              const block =
                target.entityType === 'initiative'
                  ? 'initiative'
                  : itemToBlockName({
                      type:
                        target.entityType === 'email_thread'
                          ? 'email'
                          : target.entityType,
                      fileType:
                        document?.fileType ??
                        entity?.fileType ??
                        meta.content.fileType ??
                        undefined,
                      subType:
                        document?.subType &&
                        document.subType !== 'initiative_description'
                          ? { type: document.subType }
                          : undefined,
                    });
              const applied = () => {
                onApplied?.();
                if (meta.tag === 'entity_access_requested')
                  openShareModal({
                    id: target.entityId,
                    itemType:
                      target.entityType === 'email_thread'
                        ? 'email'
                        : target.entityType,
                    blockAlias: block,
                    name: meta.content.entityName,
                    owner: state.owner ?? undefined,
                    userPermissions: getPermissions(
                      state.accessLevel ?? undefined
                    ),
                  });
              };
              span.setAttr('access_requests.outcome', 'navigation_requested');
              openSplitIfNotOpen(
                lm,
                block === 'initiative' ? 'component' : block,
                block === 'initiative'
                  ? projectRouteId({ id: target.entityId, section: 'overview' })
                  : target.entityId,
                { newSplit, sourceHandle, onApplied: applied }
              );
            } catch {
              span.setAttr('access_requests.outcome', 'error');
              span.error('Access-request notification could not be opened');
              toast.failure(
                'Could not open sharing. You may no longer have access.'
              );
            }
          });
      })
      .with('invite_to_team', () => null)
      .with(
        'call_started',
        () =>
          async (lm: SplitManager, newSplit: boolean = false) =>
            openSplitIfNotOpen(lm, 'channel', notification.entity_id, {
              newSplit,
              sourceHandle,
              onApplied,
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
              onApplied,
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
            onApplied,
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
              onApplied,
            });
            return;
          }

          let url = meta.content.url;
          if (meta.tag === 'github_pr_check_run') {
            url = meta.content.checkUrl || meta.content.url;
          }

          openExternalUrl(url);
          onApplied?.();
        };
      })
      .with('initiative_discussion', () => {
        if (!isFeatureEnabled(enableProjects)) return null;
        const meta = notification.notification_metadata;
        if (
          meta.tag !== 'initiative_discussion' ||
          notification.entity_type !== 'initiative'
        )
          return null;
        return async (lm: SplitManager, newSplit = false) => {
          openSplitIfNotOpen(
            lm,
            'component',
            projectRouteId({
              id: notification.entity_id,
              section: 'overview',
              discussionId: meta.content.messageId,
            }),
            { newSplit, sourceHandle, onApplied }
          );
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
              onApplied,
            });
        }
      )
      .with('reminder', () => {
        if (notification.entity_type !== 'email_thread') return null;
        return async (lm: SplitManager, newSplit: boolean = false) => {
          openSplitIfNotOpen(lm, 'email', notification.entity_id, {
            newSplit,
            sourceHandle,
            onApplied,
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
          if (!isFeatureEnabled(enableCalendarUi)) {
            onApplied?.();
            return;
          }
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
              ...(onApplied ? { onApplied } : {}),
            }
          );
        };
      })
      .with('calendar_event_join_request', () => {
        const meta = notification.notification_metadata;
        if (meta.tag !== 'calendar_event_join_request') return null;

        // The request is answered from the shared event's details.
        return async (lm: SplitManager, newSplit: boolean = false) => {
          if (!isFeatureEnabled(enableCalendarUi)) {
            onApplied?.();
            return;
          }
          openCalendarView(
            { eventId: meta.content.eventId },
            {
              manager: lm,
              handle: sourceHandle,
              openInNewSplit: newSplit,
              ...(onApplied ? { onApplied } : {}),
            }
          );
        };
      })
      .with('crm_discussion', () => {
        const meta = notification.notification_metadata;
        if (meta.tag !== 'crm_discussion') return null;
        const blockName =
          notification.entity_type === 'crm_contact' ? 'contact' : 'company';
        return async (lm: SplitManager, newSplit: boolean = false) => {
          // Desktop shows records in Customers, which takes the message from its route.
          if (!isTouchDevice()) {
            let pending = onApplied;
            const reportApplied = () => {
              const callback = pending;
              pending = undefined;
              callback?.();
            };
            const result = lm.openWithSplit(
              crmRecordContent(
                { type: blockName, id: notification.entity_id },
                meta.content.messageId
              ),
              {
                activate: true,
                referredFrom: null,
                preferNewSplit: newSplit,
                handle: sourceHandle,
                allowDuplicate: true,
                ...(onApplied ? { onApplied: reportApplied } : {}),
              }
            );
            if (result.status === 'opened' || result.status === 'reused')
              reportApplied();
            return;
          }
          openSplitIfNotOpen(lm, blockName, notification.entity_id, {
            newSplit,
            params: { [COMMENT_LINK_PARAM]: meta.content.messageId },
            sourceHandle,
            onApplied,
          });
        };
      })
      .with('inbox_reauth_required', () => null)
      .exhaustive(() => null)
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
  sourceHandle?: SplitHandle,
  options: { onApplied?: VoidFunction } = {}
): ResultAsync<void, NotSupportedError> {
  const handler = getSupportedHandler(
    notification,
    entity,
    sourceHandle,
    options.onApplied
  );
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
  notificationSource: NotificationSource,
  options: {
    canOpen?: () => boolean;
    onApplied?: VoidFunction;
    target?: PushNotificationNavigation;
  } = {}
): ResultAsync<void, OpenNotificationFromIdError> {
  if (options.target) {
    if (options.canOpen && !options.canOpen()) {
      return errAsync({ tag: 'NavigationDeferredError', notificationId });
    }
    const { channelId, messageId, threadId } = options.target;
    fireAndForget(
      prefetchChannelTarget(channelId, {
        messageId,
        threadId: threadId ?? messageId,
      }),
      'notification-navigation'
    );
    return ResultAsync.fromSafePromise(
      navigateToChannelMessage(
        layoutManager.getOrchestrator(),
        channelId,
        messageId,
        threadId ?? messageId,
        { splitManager: layoutManager, onApplied: options.onApplied }
      )
    );
  }
  const openIfReady = (notification: UnifiedNotification) => {
    if (options.canOpen && !options.canOpen()) {
      return errAsync({
        tag: 'NavigationDeferredError' as const,
        notificationId,
      });
    }
    return openNotification(
      notification,
      layoutManager,
      false,
      undefined,
      undefined,
      { onApplied: options.onApplied }
    );
  };

  // Check notification source first
  const cached = notificationSource
    .notifications()
    .find((n) => n.id === notificationId);
  if (cached) {
    return openIfReady(cached);
  }

  // Fetch if not in notification source
  return ResultAsync.fromSafePromise(
    getNotificationById(notificationId)
  ).andThen((unified) => {
    if (!unified) {
      const err: NotFoundError = { tag: 'NotFoundError', notificationId };
      return errAsync(err);
    }
    return openIfReady(unified);
  });
}
