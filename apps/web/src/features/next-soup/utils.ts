import { isListViewID } from '@app/constants/list-views';
import { scopeChannelNotificationsForEntity } from '@app/features/soup/entity-notifications';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createCalendarBlockRange } from '@block-calendar/calendar-range';
import {
  CALENDAR_BLOCK_ID,
  type CalendarBlockProps,
} from '@block-calendar/types';
import { URL_PARAMS as CALL_PARAMS } from '@block-call/constants';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import {
  getChannelParams,
  goToChannelLatest,
  goToChannelMessage,
} from '@block-channel/utils/link';
import { URL_PARAMS as EMAIL_PARAMS } from '@block-email/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/constants';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import {
  ENABLE_CALENDAR_UI,
  USE_MACRO_PR_SUMMARY_BLOCK,
} from '@core/constant/featureFlags';
import {
  ENTITY_ID_DATA_ATTRIBUTE,
  entityIdSelector,
} from '@core/dom-selectors';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { DateValue } from '@core/util/date';
import { throwOnErr } from '@core/util/result';
import { waitForFrames } from '@core/util/sleep';
import { openExternalUrl } from '@core/util/url';
import {
  type ChannelClickTarget,
  type EntityData,
  emailQueryKeyExcludesDone,
  getSnippetHit,
  isChannelEntity,
  isEmailEntity,
  isGithubPrEntity,
  isHitSnippetEntity,
  isNonMemberChannelEntity,
  isSearchEntity,
  isWithNotification,
  queryKeys,
  type ReminderEntity,
  type SearchLocation,
  toNotificationEntity,
  type WithSearch,
} from '@entity';
import {
  compositeEntity,
  getChannelNotificationParams,
  markNotificationsForEntityAsRead,
  type NotificationSource,
  notificationIsRead,
  setDoneOverride,
  type UnifiedNotification,
} from '@notifications';
import { queryClient } from '@queries/client';
import { emailKeys } from '@queries/email/keys';
import {
  type NotificationEntityRef,
  updateNotificationsForEntities,
} from '@queries/notification/entity-mutations';
import { notificationKeys } from '@queries/notification/keys';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
  restoreUserNotifications,
  snapshotUserNotifications,
} from '@queries/notification/user-notifications';
import {
  invalidateRemindersById,
  setReminderCompleted,
} from '@queries/reminders/reminders';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  optimisticUpdateSoupEntity,
  removeSoupEntities,
  removeSoupEntitiesFromDoneFilteredQueries,
} from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
import { isAfter } from 'date-fns';
import { match } from 'ts-pattern';
import { withPreviewSourceEntityId } from './preview-history';

export { scopeChannelNotificationsForEntity };

const mergeSearchEntities = <T extends EntityData>(
  first: WithSearch<T>,
  second: WithSearch<T>
): WithSearch<T> => {
  const serviceEntity = first.search.source === 'service' ? first : second;
  const localEntity = first.search.source === 'local' ? first : second;
  const hasLocal =
    first.search.source === 'local' || second.search.source === 'local';

  // NOTE: we that the longer name highlight is more relevant since it will contain a macro highlight tag
  let nameHighlight;
  if (serviceEntity.search.nameHighlight && localEntity.search.nameHighlight) {
    nameHighlight =
      serviceEntity.search.nameHighlight.length >=
      localEntity.search.nameHighlight.length
        ? serviceEntity.search.nameHighlight
        : localEntity.search.nameHighlight;
  } else {
    nameHighlight =
      serviceEntity.search.nameHighlight || localEntity.search.nameHighlight;
  }

  return {
    ...localEntity,
    ...serviceEntity,
    search: {
      ...serviceEntity.search,
      source: hasLocal ? 'local' : 'service',
      nameHighlight,
      contentHitData: serviceEntity.search.contentHitData?.length
        ? serviceEntity.search.contentHitData
        : localEntity.search.contentHitData,
    },
  };
};

/**
 * Deduplicates entities by id, preferring entities with search data from 'service' source
 * over 'local' source, and using latest timestamp as a tiebreaker.
 * When preferring service results, merges local nameHighlight if service doesn't have one.
 */
export const deduplicateEntities = <T extends EntityData>(
  entities: T[]
): T[] => {
  const entityMap = new Map<string, T>();

  for (const entity of entities) {
    const existing = entityMap.get(entity.id);

    if (!existing) {
      entityMap.set(entity.id, entity);
      continue;
    }

    const existingHasSearch = isSearchEntity(existing);
    const newHasSearch = isSearchEntity(entity);

    // Prefer entities with search data
    if (newHasSearch && !existingHasSearch) {
      entityMap.set(entity.id, entity);
      continue;
    }

    // If both have search data, prefer 'service' over 'local'
    if (existingHasSearch && newHasSearch) {
      const existingSource = existing.search.source;
      const newSource = entity.search.source;

      if (
        (newSource === 'service' && existingSource === 'local') ||
        (existingSource === 'service' && newSource === 'local')
      ) {
        // Merge service and local search data
        entityMap.set(entity.id, mergeSearchEntities(entity, existing));
        continue;
      }

      // If both are the same source, keep the one with latest timestamp
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
      continue;
    }

    // If neither has search, keep the one with latest timestamp
    if (!existingHasSearch && !newHasSearch) {
      if (isNewerEntity(entity, existing)) {
        entityMap.set(entity.id, entity);
      }
    }
    // Otherwise keep existing (it has search and new doesn't)
  }

  return Array.from(entityMap.values());
};

/**
 * Gets the timestamp of an entity (updatedAt or createdAt)
 */
const getEntityTimestamp = (entity: EntityData): DateValue => {
  return entity.updatedAt ?? entity.createdAt ?? new Date(0);
};

/**
 * Returns true if the new entity should replace the existing one based on timestamp. If the timestamp is the same, prefer to use the newer entity to handle optimistic updates
 */
const isNewerEntity = (
  newEntity: EntityData,
  existing: EntityData
): boolean => {
  return isAfter(getEntityTimestamp(newEntity), getEntityTimestamp(existing));
};

/**
 * Opens an entity via {@link openExternalUrl}. On web this is a new browser
 * tab; inside the native Tauri shell a same-origin Macro `/app` link is routed
 * in-app (in place) instead — `window.open` there would kick the user out to
 * the system browser. So despite the name, this does not guarantee a separate
 * tab/pane under Tauri.
 */
export const openEntityInNewTab = ({
  entity,
  location,
}: {
  entity: EntityData;
  location?: SearchLocation;
}) => {
  // A reminder has no route of its own — it opens what it references, the
  // same as the split paths. A standalone one references nothing, so there is
  // no tab to open.
  if (entity.type === 'reminder') {
    const target = reminderSplitTarget(entity);
    if (!target) return;
    openExternalUrl(
      new URL(`/app/${target.type}/${target.id}`, window.location.origin).href
    );
    return;
  }

  // Build URL for the entity
  let entityPath: string;
  if (entity.type === 'calendar_event') {
    entityPath = `/app/calendar/${CALENDAR_BLOCK_ID}`;
  } else if (entity.type === 'document') {
    const { fileType, subType } = entity;
    const blockName = fileTypeToBlockName(subType?.type ?? fileType);
    entityPath = `/app/${blockName}/${entity.id}`;
  } else if (
    entity.type === 'channel_message' ||
    entity.type === 'channel_thread'
  ) {
    entityPath = `/app/channel/${entity.channelId}`;
  } else {
    entityPath = `/app/${entity.type}/${entity.id}`;
  }

  // Add location params if present
  let entityUrl = new URL(entityPath, window.location.origin);

  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    entityUrl.searchParams.set(CHANNEL_PARAMS.message, entity.messageId);
    if (entity.threadId) {
      entityUrl.searchParams.set(CHANNEL_PARAMS.thread, entity.threadId);
    }
  } else if (location) {
    switch (location.type) {
      case 'channel':
        if (location.messageId) {
          entityUrl.searchParams.set(
            CHANNEL_PARAMS.message,
            location.messageId
          );
        }
        if (location.threadId) {
          entityUrl.searchParams.set(CHANNEL_PARAMS.thread, location.threadId);
        }
        break;
      case 'email':
        if (location.messageId) {
          entityUrl.searchParams.set('email_message_id', location.messageId);
        }

        break;
      case 'md':
        if (location.nodeId) {
          entityUrl.searchParams.set('node_id', location.nodeId);
        }
        break;
      case 'pdf':
        if (location.searchPage !== undefined) {
          entityUrl.searchParams.set(
            'search_page',
            location.searchPage.toString()
          );
        }
        if (location.searchRawQuery) {
          entityUrl.searchParams.set(
            'search_raw_query',
            location.searchRawQuery
          );
        }
        if (location.highlightTerms) {
          entityUrl.searchParams.set(
            'search_highlight_terms',
            JSON.stringify(location.highlightTerms)
          );
        }
        if (location.searchSnippet) {
          entityUrl.searchParams.set('search_snippet', location.searchSnippet);
        }
        break;
      case 'call_record':
        if (location.transcriptId) {
          entityUrl.searchParams.set(
            CALL_PARAMS.transcriptId,
            location.transcriptId
          );
        }
        break;
    }
  }

  openExternalUrl(entityUrl.toString());
};

/**
 * Restores DOM focus to an entity row in the soup view after a modal action completes.
 * This is necessary because the hotkey system is focus-based, and modals steal
 * focus away from the soup view. Without restoring DOM focus, scoped hotkeys
 * like 'escape' won't work.
 *
 * @param entityId - Optional entity ID to focus on. If not provided, focuses the first entity in the list.
 */
export const restoreSoupFocus = async (entityId?: string): Promise<void> => {
  // Get the active split's soup view DOM reference
  const activeSplitId = globalSplitManager()?.activeSplitId();
  if (!activeSplitId) return;

  const domRef = document.querySelector(
    `[data-soup-view-id="${activeSplitId}"]`
  );

  if (!(domRef instanceof HTMLElement)) return;

  // Wait for DOM to update after modal closes
  await waitForFrames(2);

  // Entity rows are plain divs without a `tabindex` attribute so `.focus()`
  // on them is a no-op. Targeting them is still useful because the browser
  // may scroll them into view as part of the focus attempt. Always follow
  // up by focusing the soup container (which has `tabindex={-1}`) — that's
  // what actually reactivates the hotkey scope.
  if (entityId) {
    const entityEl = domRef.querySelector(entityIdSelector(entityId));
    if (entityEl instanceof HTMLElement) entityEl.focus();
  }

  if (document.activeElement && domRef.contains(document.activeElement)) return;

  const firstEntityEl = domRef.querySelector(`[${ENTITY_ID_DATA_ATTRIBUTE}]`);
  if (firstEntityEl instanceof HTMLElement) firstEntityEl.focus();

  if (document.activeElement && domRef.contains(document.activeElement)) return;

  domRef.focus();
};

interface OpenEntityOptions {
  openInNewSplit?: boolean;
  /**
   * Open in place of the whole Preview Pair: the Viewer closes and the content
   * replaces the Controller. No-op outside a Preview Pair.
   */
  replacePreview?: boolean;
  location?: SearchLocation;
  splitHandle?: SplitHandle;
  mergeHistory?: boolean;
  allowDuplicate?: boolean;
  referredFrom?: ReferredFrom;
}

const DUPLICATE_CONTENT_MESSAGE = 'Content already open.';

/** Whether this entity is open outside the controller's own preview viewer. */
export function isDuplicatePreviewEntityOpen(
  entity: EntityData,
  controller: SplitHandle
): boolean {
  const splitManager = globalSplitManager();
  const viewerId = controller.viewerId();
  if (!splitManager || !viewerId) return false;

  const content = getEntitySplitContent(entity);
  const existing = splitManager.getSplitByContent(content.type, content.id);
  return existing !== undefined && existing.id !== viewerId;
}

/** Show the standard duplicate-content notification. */
export function notifyDuplicateContentOpen() {
  toast.alert(DUPLICATE_CONTENT_MESSAGE);
}

/** Reject and notify for an entity already owned by another split. */
export function preventDuplicatePreviewEntityOpen(
  entity: EntityData,
  controller: SplitHandle
): boolean {
  if (!isDuplicatePreviewEntityOpen(entity, controller)) return false;
  notifyDuplicateContentOpen();
  return true;
}

/**
 * Resolve which channel message to activate when a channel row is opened.
 *
 * A row with an explicit `target` (stamped at construction, e.g. a search hit
 * standing for one matched message) always activates it. Notifications must
 * never override a stamped target: the unified list attaches a channel-wide
 * notifications() accessor to every row (search results included), so their
 * presence says nothing about why a row exists.
 *
 * Rows without a target are containers — a `channel` row is the whole channel
 * and a `channel_thread` row is keyed by its root, so neither carries the id
 * of the message/reply that put it in the inbox. That id lives only on the
 * driving notification (the same data the card renders), so read the target
 * from there, exactly like the old inbox did via getChannelNotificationParams.
 * Notifications are scoped to the row first (top-level sends for a channel,
 * this thread's replies for a thread) and the most recent one wins.
 *
 * Read state only changes a whole-`channel` row: its notifications are skipped
 * when read, because a channel aggregates many messages and the newest unread
 * one (never your own send) can sit far above the latest — jumping there feels
 * wrong once the row looks read. A `channel_thread`/`channel_message` row is
 * scoped to one message, so it targets its driving notification read or not —
 * that is the reply the row stands for and the message to highlight.
 *
 * With no aiming notification, fall back to the row's own semantics: a
 * `channel_thread`/`channel_message` row opens at its own root/message, and a
 * whole `channel` row opens at `latest` — landing on the newest message the
 * row's preview shows (which may be your own send) rather than an older
 * notification or nothing.
 */
export function getChannelEntityTarget(
  entity: EntityData
): ChannelClickTarget | undefined {
  if (
    entity.type !== 'channel' &&
    entity.type !== 'channel_message' &&
    entity.type !== 'channel_thread'
  ) {
    return undefined;
  }

  if (entity.target) {
    return {
      kind: 'message',
      messageId: entity.target.messageId,
      threadId: entity.target.threadId,
    };
  }

  const fallback: ChannelClickTarget =
    entity.type === 'channel'
      ? { kind: 'latest' }
      : {
          kind: 'message',
          messageId: entity.messageId,
          threadId: entity.threadId,
        };

  if (!isWithNotification(entity)) return fallback;

  const scoped = scopeChannelNotificationsForEntity(
    entity,
    entity.notifications?.() ?? []
  );
  for (const notification of scoped) {
    // For a whole-`channel` row, ignore notifications you have already read:
    // the row stands for the entire channel, so once read it should open at
    // the latest message, not scroll up to an already-seen one. (Read ones
    // are skipped here; if all are read the loop falls through to the
    // `latest` fallback.) A read notification is also usually well above the
    // latest message — you are never notified of your own sends, so the newest
    // notification is someone else's and predates any message you sent after.
    //
    // A thread/message row stands for one specific message, so it always jumps
    // to its notification's message, read or not — that is the message the row
    // is about and the one to highlight.
    if (entity.type === 'channel' && notificationIsRead(notification)) continue;
    const { messageId, threadId } = getChannelNotificationParams(notification);
    if (messageId) return { kind: 'message', messageId, threadId };
  }

  return fallback;
}

/**
 * Activate a channel row's target message in its (already-open) channel block.
 *
 * Callable imperatively per click: re-selecting the same row leaves the preview
 * entity unchanged, so a reactive derivation would never re-run — but a click
 * should always re-activate the target (e.g. after the user cleared the
 * highlight by clicking a message), matching the old inbox's per-click
 * behaviour. No-ops for non-channel entities or when there is no target.
 */
export async function navigateChannelEntityToTarget(
  entity: EntityData,
  blockOrchestrator: BlockOrchestrator
): Promise<void> {
  const target = getChannelEntityTarget(entity);
  if (!target) return;

  const channelId =
    entity.type === 'channel'
      ? entity.id
      : entity.type === 'channel_message' || entity.type === 'channel_thread'
        ? entity.channelId
        : undefined;
  if (!channelId) return;

  if (target.kind === 'latest') {
    await goToChannelLatest(blockOrchestrator, channelId);
    return;
  }

  await goToChannelMessage(
    blockOrchestrator,
    channelId,
    target.messageId,
    target.threadId
  );
}

/**
 * Location a plain row click falls back to when no explicit location is given.
 * Email rows open like plain soup rows — at the latest message, expanded —
 * so only non-email snippet entities (calls) fall back to their row hit.
 * Clicking a specific content hit still passes an explicit location.
 */
export const getRowClickFallbackLocation = (
  entity: EntityData
): SearchLocation | undefined =>
  isHitSnippetEntity(entity) && !isEmailEntity(entity)
    ? getSnippetHit(entity)?.location
    : undefined;

/**
 * Opens an entity in a split, handling navigation to specific locations within the entity.
 * Supports both regular entities (channel, email, etc.) and document entities.
 *
 * @param entity - The entity to open
 * @param options - Configuration options including whether to open in new split, location, and split handle
 */
export const openEntityInSplitFromUnifiedList = async (
  entity: EntityData,
  options: OpenEntityOptions
): Promise<void> => {
  const {
    allowDuplicate,
    openInNewSplit,
    replacePreview,
    splitHandle,
    mergeHistory,
  } = options;
  let { location } = options;

  if (!location) {
    location = getRowClickFallbackLocation(entity);
  }

  // Get dependencies internally
  const splitManager = globalSplitManager();
  if (!splitManager) {
    console.error('No split manager found');
    return;
  }

  // Channels the viewer hasn't joined can't be read. In a Preview Pair, offer
  // the Join prompt in the Viewer; otherwise the row's inline Join button is
  // the only affordance.
  if (isNonMemberChannelEntity(entity)) {
    if (isChannelEntity(entity) && splitHandle?.isControllerSplit()) {
      const joinPromptContent = withPreviewSourceEntityId(
        {
          type: 'component',
          id: 'non-member-channel',
          params: {
            channelId: entity.id,
            channelName: entity.name,
            memberCount: entity.participantIds?.length ?? 0,
          },
        },
        entity.id
      );
      splitManager.openWithSplit(joinPromptContent, {
        referredFrom: options.referredFrom,
        activate: true,
        handle: splitHandle,
      });
    }
    return;
  }

  if (isGithubPrEntity(entity)) {
    if (USE_MACRO_PR_SUMMARY_BLOCK) {
      splitManager.openWithSplit(
        { type: 'pr', id: entity.id },
        {
          referredFrom: options.referredFrom,
          activate: true,
          preferNewSplit: openInNewSplit,
          replacePreview,
          handle: splitHandle,
          mergeHistory,
        }
      );
    } else {
      openExternalUrl(entity.metadata.url);
    }
    return;
  }
  if (entity.type === 'foreign') return;

  const blockOrchestrator = splitManager.getOrchestrator();

  // A standalone reminder points at nothing, so there is nothing to open.
  if (entity.type === 'reminder' && !entity.referencedEntity) return;

  // Calendar is a singleton block. Event opens retarget that one instance
  // with a locator range, including repeat clicks on an already-open split.
  if (entity.type === 'calendar_event') {
    if (!ENABLE_CALENDAR_UI()) return;
    const params = calendarBlockParamsForEntity(entity);
    const existing = splitManager.getSplitByContent(
      'calendar',
      CALENDAR_BLOCK_ID
    );
    if (existing) {
      existing.activate();
    } else {
      splitManager.openWithSplit(
        { type: 'calendar', id: CALENDAR_BLOCK_ID, params },
        {
          activate: true,
          referredFrom: null,
          preferNewSplit: openInNewSplit,
          handle: splitHandle,
        }
      );
    }
    const calendarHandle = await blockOrchestrator.getBlockHandle(
      CALENDAR_BLOCK_ID,
      'calendar'
    );
    await calendarHandle?.goToLocationFromParams(params);
    return;
  }

  const content = getEntitySplitContent(entity);

  if (
    !allowDuplicate &&
    !openInNewSplit &&
    !replacePreview &&
    splitHandle &&
    preventDuplicatePreviewEntityOpen(entity, splitHandle)
  ) {
    return;
  }

  const channelTarget = getChannelEntityTarget(entity);
  const channelMessageTarget =
    channelTarget?.kind === 'message' ? channelTarget : undefined;
  const openChannelAtLatest = channelTarget?.kind === 'latest';

  let params: Record<string, string> | undefined;
  if (entity.type === 'channel' && location?.type === 'channel') {
    params = getChannelParams(location.messageId, location.threadId);
  } else if (channelMessageTarget) {
    params = getChannelParams(
      channelMessageTarget.messageId,
      channelMessageTarget.threadId
    );
  } else if (entity.type === 'call' && location?.type === 'call_record') {
    params = { [CALL_PARAMS.transcriptId]: location.transcriptId };
  }

  const sourceContent =
    splitHandle?.content() ?? splitManager.activeSplit()?.content();

  const sourceListView =
    sourceContent?.type === 'component' && isListViewID(sourceContent.id)
      ? sourceContent.id
      : undefined;
  const referredFrom = options.referredFrom ?? sourceListView;

  let splitContent: SplitContent = { ...content, params };
  // Preview source metadata belongs on Viewer entries; a replacement takes the
  // Preview Pair's place, so its entry is ordinary split history.
  if (splitHandle?.isControllerSplit() && !replacePreview) {
    splitContent = withPreviewSourceEntityId(splitContent, entity.id);
  }

  splitManager.openWithSplit(splitContent, {
    referredFrom,
    activate: true,
    preferNewSplit: openInNewSplit,
    replacePreview,
    handle: splitHandle,
    mergeHistory,
    allowDuplicate,
    reopen:
      entity.type === 'channel' && !location && openChannelAtLatest
        ? 'latest'
        : undefined,
  });

  // Navigate to specific location if provided
  if (location) {
    await navigateToLocation(content.id, location, blockOrchestrator);
  } else if (channelMessageTarget) {
    // NOTE: This will force target message navigation in case the split is already open.
    await navigateToLocation(
      content.id,
      {
        type: 'channel',
        messageId: channelMessageTarget.messageId,
        threadId: channelMessageTarget.threadId,
      },
      blockOrchestrator
    );
  } else if (openChannelAtLatest) {
    // Force the scroll-to-bottom even when the channel is already open in a
    // (preview) split, where reopen: 'latest' only reactivates the parked
    // split without re-pinning it to the newest message.
    await goToChannelLatest(blockOrchestrator, content.id);
  }
};

/**
 * Mark the attached notification that caused a channel row to target a message.
 *
 * The row's Soup edge is authoritative here. The channel block's message marker
 * discovers notifications through the separately paginated global source, so
 * an older notification can drive navigation without being present there.
 */
export function markChannelTargetSeenOnOpen(
  entity: EntityData,
  notificationSource: NotificationSource
) {
  const target = getChannelEntityTarget(entity);
  if (target?.kind !== 'message' || !isWithNotification(entity)) return;

  const notifications = scopeChannelNotificationsForEntity(
    entity,
    entity.notifications?.() ?? []
  ).filter((notification) => {
    if (notificationIsRead(notification)) return false;
    return (
      getChannelNotificationParams(notification).messageId === target.messageId
    );
  });
  if (notifications.length === 0) return;

  void notificationSource.bulkMarkAsRead(notifications).catch((error) => {
    console.error('Failed to mark message notifications as read', error);
  });
}

/**
 * Mark a reminder's notification read when the user opens it.
 *
 * Every other entity type gets this for free from the block it opens into,
 * which mounts `DebouncedNotificationReadMarker`. A reminder has no block of
 * its own — it navigates to whatever it references, and that block's marker
 * clears the referenced entity's notifications, not the reminder's. So opening
 * is the only signal we get, and without this the row keeps its unread dot
 * forever.
 *
 * Seen, not done: the reminder stays in Signal until the user dismisses it.
 */
export function markReminderSeenOnOpen(
  entity: EntityData,
  notificationSource: NotificationSource
) {
  // Calendar events share the reminder situation: they open the calendar
  // component split, which has no block to clear the notification either.
  if (entity.type !== 'reminder' && entity.type !== 'calendar_event') return;
  void markNotificationsForEntityAsRead(notificationSource, {
    type: entity.type,
    id: entity.id,
  });
}

/** Build the singleton block params for an event row's target occurrence. */
/**
 * The event and instance a calendar row points at, resolved exactly as the
 * open path resolves it so a copied link lands where a click would.
 */
export function calendarEventLinkTarget(
  entity: Extract<EntityData, { type: 'calendar_event' }>
): { eventId: string; occurrenceKey?: string } {
  const { eventId, occurrenceKey } = calendarBlockParamsForEntity(entity);
  return { eventId: eventId ?? entity.id, occurrenceKey };
}

function calendarBlockParamsForEntity(
  entity: Extract<EntityData, { type: 'calendar_event' }>
): CalendarBlockProps {
  const notifications = isWithNotification(entity)
    ? (entity.notifications?.() ?? [])
    : [];
  const metadata = notifications
    .map((notification) => notification.notification_metadata)
    .find((candidate) => candidate?.tag === 'calendar_event_reminder');
  const content =
    metadata?.tag === 'calendar_event_reminder' ? metadata.content : undefined;
  const time = content?.startsAt
    ? {
        kind: 'timed' as const,
        startsAt: content.startsAt,
        endsAt: content.endsAt ?? undefined,
      }
    : content?.startDate
      ? { kind: 'allDay' as const, startDate: content.startDate }
      : entity.time;

  return {
    eventId: content?.eventId ?? entity.id,
    // A reminder names a precise instance, so it wins; otherwise fall back to
    // whatever resolved the row (search supplies one, soup does not).
    occurrenceKey: content?.occurrenceKey ?? entity.occurrenceKey,
    range: time ? createCalendarBlockRange(time) : undefined,
  };
}

/**
 * The split a reminder opens: the entity it references, never itself.
 * `undefined` for a standalone reminder, which points at nothing — callers use
 * that to decide whether opening is possible at all.
 *
 * `fileType`/`subType` come resolved from the server, so a referenced document
 * lands on its real block rather than 'unknown'.
 */
export function reminderSplitTarget(entity: ReminderEntity) {
  const referenced = entity.referencedEntity;
  if (!referenced) return undefined;
  return {
    type: fileTypeToBlockName(
      referenced.subType ?? referenced.fileType ?? referenced.type
    ),
    id: referenced.id,
  };
}

// TODO(dev-rb/github): Map GitHub PRs to { type: 'pr', id }.
function getEntitySplitContent(entity: EntityData) {
  return (
    match(entity)
      .with({ type: 'document' }, (entity) => {
        const { id, fileType, subType } = entity;
        const blockName = fileTypeToBlockName(subType?.type ?? fileType);

        return { type: blockName, id };
      })
      .with({ type: 'channel_message' }, (entity) => {
        return { type: 'channel' as const, id: entity.channelId };
      })
      .with({ type: 'channel_thread' }, (entity) => {
        return { type: 'channel' as const, id: entity.channelId };
      })
      .with({ type: 'foreign' }, (entity) => {
        return { type: 'unknown' as const, id: entity.id };
      })
      .with({ type: 'crm_company' }, (entity) => {
        return { type: 'company' as const, id: entity.id };
      })
      .with({ type: 'crm_contact' }, (entity) => {
        return { type: 'contact' as const, id: entity.id };
      })
      .with({ type: 'reminder' }, (entity) => {
        return (
          reminderSplitTarget(entity) ?? {
            type: 'unknown' as const,
            id: entity.id,
          }
        );
      })
      // Calendar events open the singleton calendar block; the open path
      // branches before reaching here, so this only serves duplicate checks.
      .with({ type: 'calendar_event' }, () => {
        return { type: 'calendar' as const, id: CALENDAR_BLOCK_ID };
      })
      .otherwise((entity) => {
        return { type: entity.type, id: entity.id };
      })
  );
}

/**
 * Navigates to a specific location within a block.
 */
async function navigateToLocation(
  entityId: string,
  location: SearchLocation,
  blockOrchestrator: BlockOrchestrator
): Promise<void> {
  const blockHandle = await blockOrchestrator.getBlockHandle(entityId);
  if (!blockHandle) return;

  switch (location.type) {
    case 'channel': {
      // NOTE: this is handled by the channel block params but this can be used to re-flash an open channel
      await blockHandle.goToLocationFromParams(
        getChannelParams(location.messageId, location.threadId)
      );
      break;
    }
    case 'email': {
      await blockHandle.goToLocationFromParams({
        [EMAIL_PARAMS.messageId]: location.messageId,
      });
      break;
    }
    case 'md': {
      await blockHandle.goToLocationFromParams({
        [MD_PARAMS.nodeId]: location.nodeId,
      });
      break;
    }
    case 'pdf': {
      await blockHandle.goToLocationFromParams({
        [PDF_PARAMS.searchPage]: location.searchPage.toString(),
        [PDF_PARAMS.searchRawQuery]: location.searchRawQuery,
        [PDF_PARAMS.searchHighlightTerms]: JSON.stringify(
          location.highlightTerms
        ),
        [PDF_PARAMS.searchSnippet]: location.searchSnippet,
      });
      break;
    }
    case 'call_record': {
      await blockHandle.goToLocationFromParams({
        [CALL_PARAMS.transcriptId]: location.transcriptId,
      });
      break;
    }
  }
}

async function _archiveEmail(
  id: string,
  options: { archive: boolean; optimisticallyExclude?: boolean }
) {
  await queryClient.cancelQueries({ queryKey: queryKeys.all.email });

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });

  const current = getSoupEntityById(id);
  const soupTxn = options.optimisticallyExclude
    ? removeSoupEntities(new Set([id]))
    : optimisticUpdateSoupEntity({
        tag: 'emailThread',
        data: { id, inboxVisible: false },
        frecency_score: current?.frecency_score ?? 0,
      });

  // Optimistic update for email queries
  const applyEmailOptimistic = (data?: {
    pages: { items: EntityData[] }[];
  }) => {
    if (!data) return data;

    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: options.optimisticallyExclude
          ? page.items.filter((item) => item.id !== id)
          : page.items.map((item) =>
              item.id === id ? { ...item, inboxVisible: false } : item
            ),
      })),
    };
  };

  for (const [key, data] of previousEmail) {
    queryClient.setQueryData(key, applyEmailOptimistic(data));
  }

  try {
    await emailClient.flagArchived({ value: options.archive, id });
  } catch (_err) {
    soupTxn.rollback();
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
  } finally {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      invalidateSoupEntity(id),
    ]);
  }
}

type TrashEmailsHandle = {
  /** Fire-and-forget promise for the API calls. Rejects on failure (rolls back optimistic update). */
  done: Promise<void>;
  /** Optimistically restores all entities and calls the API to remove the TRASH label. */
  undo: () => Promise<void>;
};

/**
 * Optimistically removes one or more email threads from soup + email caches,
 * then fires the TRASH label API calls in the background. Takes a single
 * snapshot before all removals so undo restores the complete pre-trash state.
 * Returns synchronously so the caller can show the undo toast immediately.
 */
export function trashEmails(ids: string[]): TrashEmailsHandle {
  queryClient.cancelQueries({ queryKey: queryKeys.all.email });

  const previousEmail = queryClient.getQueriesData<{
    pages: { items: EntityData[] }[];
  }>({
    queryKey: queryKeys.all.email,
  });

  const idSet = new Set(ids);
  const soupTxn = removeSoupEntities(idSet);

  // Optimistically remove from email queries
  for (const [key, data] of previousEmail) {
    if (!data) continue;
    queryClient.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => !idSet.has(item.id)),
      })),
    });
  }

  const rollback = () => {
    soupTxn.rollback();
    for (const [key, data] of previousEmail) {
      queryClient.setQueryData(key, data);
    }
  };

  // Resolved lazily by the API calls; used by undo
  let trashLabelId: string | undefined;

  const done = (async () => {
    try {
      const labelsData = await queryClient.fetchQuery({
        queryKey: emailKeys.labels.queryKey,
        queryFn: async () =>
          throwOnErr(async () => await emailClient.getUserLabels()),
        staleTime: 5 * 60 * 1000,
      });
      const trashLabel = labelsData?.labels.find(
        (l) => l.providerLabelId === 'TRASH'
      );
      const labelId = trashLabel?.id;
      if (!labelId) {
        throw new Error('TRASH label not found');
      }
      trashLabelId = labelId;

      await Promise.all(
        ids.map((id) =>
          emailClient.updateThreadLabel({
            thread_id: id,
            label_id: labelId,
            value: true,
          })
        )
      );
    } catch (err) {
      rollback();
      throw err;
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
        ...ids.map((id) => invalidateSoupEntity(id)),
      ]);
    }
  })();

  return {
    done,
    undo: async () => {
      // Wait for the trash calls to finish so we know the label ID.
      // If the trash call itself failed, rollback already happened — nothing to undo.
      try {
        await done;
      } catch {
        return;
      }

      rollback();

      try {
        await Promise.all(
          ids.map((id) =>
            emailClient.updateThreadLabel({
              thread_id: id,
              label_id: trashLabelId!,
              value: false,
            })
          )
        );
      } finally {
        // Only invalidate email queries — skip soup invalidation since
        // rollback() already restored the correct cache state.
        await queryClient.invalidateQueries({
          queryKey: queryKeys.all.email,
          refetchType: 'none',
        });
      }
    },
  };
}

export type MarkEntitiesDoneContext = {
  /** Clears optimistic state — use for mark-done failure (cache is pre-mutation). */
  rollback: () => void;
  /** Re-applies the optimistic done state. Use for redo / undo failure. */
  reapply: () => void;
  /** Reverts email/soup caches and forces `done=false` override. Use for undo. */
  applyUndone: () => void;
};

function notificationsForMarkDone(
  entity: EntityData,
  notifications: UnifiedNotification[],
  scopeChannelNotificationsToEntity: boolean
): UnifiedNotification[] {
  if (!scopeChannelNotificationsToEntity) return notifications;

  return scopeChannelNotificationsForEntity(entity, notifications);
}

/**
 * Extract the email ids and notification ids targeted by a mark-done on these
 * entities. The ids are snapshotted here so mutationFn/undoFn/redoFn operate
 * on the set that existed at mutation time.
 */
export function resolveMarkEntitiesDoneVariables(args: {
  entities: EntityData[];
  notificationSource: NotificationSource;
  /**
   * Channel and channel_thread entities share the same notification bucket.
   * When true, channel mark-done skips thread-stack notifications, and
   * channel_thread mark-done only targets that thread's stack.
   */
  scopeChannelNotificationsToEntity?: boolean;
}): { emailIds: string[]; notificationIds: string[]; reminderIds: string[] } {
  const {
    entities,
    notificationSource,
    scopeChannelNotificationsToEntity = false,
  } = args;
  const emailIds = entities.filter((e) => e.type === 'email').map((e) => e.id);
  // A reminder's done state is its own column, not its notification's: a
  // reminder that has not fired yet has no notification to mark, and the
  // Reminders view filters on the column.
  const reminderIds = entities
    .filter((e) => e.type === 'reminder')
    .map((e) => e.id);
  const notificationIds = entities.flatMap((entity) => {
    // GraphQL Soup rows carry their own notification edge. Prefer that edge
    // over the global notification query, which may not have paged far enough
    // to include this entity yet.
    const attachedNotifications = isWithNotification(entity)
      ? entity.notifications?.()
      : undefined;
    const notificationsForEntity =
      attachedNotifications ??
      notificationSource.notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ] ??
      [];

    return notificationsForMarkDone(
      entity,
      notificationsForEntity,
      scopeChannelNotificationsToEntity
    ).map((n) => n.id);
  });

  return {
    emailIds: [...new Set(emailIds)],
    notificationIds: [...new Set(notificationIds)],
    reminderIds: [...new Set(reminderIds)],
  };
}

/**
 * Applies the optimistic UI state for marking entities as done — removes the
 * entities from done-filtered soup/email caches, flips surviving email rows
 * to the done state, and sets the notification `done` override. Returns a
 * context the mutation uses for rollback / reapply.
 */
export function applyEntitiesDoneOptimistic(args: {
  entityIds: string[];
  emailIds: string[];
  notificationIds: string[];
  reminderIds?: string[];
}): MarkEntitiesDoneContext {
  const { entityIds, emailIds, notificationIds, reminderIds = [] } = args;
  const emailIdSet = new Set(emailIds);
  const entityIdSet = new Set(entityIds);

  // Snapshot the affected notifications before marking done. A done
  // notification gets dropped from the cache (status-update event or a stale
  // refetch), so undo re-adds it here so the soup `notDoneFilter` predicate
  // lets the restored entity through again.
  const notificationSnapshots = snapshotUserNotifications(notificationIds);

  type EmailQueryKey = readonly unknown[];
  type EmailCacheData = { pages: { items: EntityData[] }[] };
  const removedEmails = new Map<EmailQueryKey, Map<string, EntityData>>();

  const filterEmailCache = () => {
    if (emailIdSet.size === 0) return;
    for (const [key, data] of queryClient.getQueriesData<EmailCacheData>({
      queryKey: queryKeys.all.email,
    })) {
      if (!data) continue;
      // Views that show done threads keep their rows.
      if (!emailQueryKeyExcludesDone(key)) continue;
      const bucket = removedEmails.get(key) ?? new Map<string, EntityData>();
      let mutated = false;
      const pages = data.pages.map((page) => {
        const items: EntityData[] = [];
        for (const item of page.items) {
          if (emailIdSet.has(item.id)) {
            bucket.set(item.id, item);
            mutated = true;
          } else {
            items.push(item);
          }
        }
        return mutated && items.length !== page.items.length
          ? { ...page, items }
          : page;
      });
      if (mutated) {
        removedEmails.set(key, bucket);
        queryClient.setQueryData(key, { ...data, pages });
      }
    }
  };

  const restoreEmailCache = () => {
    for (const [key, bucket] of removedEmails) {
      if (bucket.size === 0) continue;
      const toRestore = [...bucket.values()];
      bucket.clear();
      queryClient.setQueryData<EmailCacheData>(key, (current) => {
        if (!current) return current;
        const restoredIds = new Set(toRestore.map((e) => e.id));
        return {
          ...current,
          pages: current.pages.map((page, idx) => {
            const filtered = page.items.filter((i) => !restoredIds.has(i.id));
            if (idx === 0) {
              return { ...page, items: [...toRestore, ...filtered] };
            }
            if (filtered.length === page.items.length) {
              return page;
            }
            return { ...page, items: filtered };
          }),
        };
      });
    }
  };

  let soupTxn: ReturnType<typeof removeSoupEntities> | null = null;
  let emailRowTxns: { rollback: () => void }[] = [];
  let reminderRowTxns: { rollback: () => void }[] = [];
  const completedStamp = new Date().toISOString();

  const reapply = () => {
    // Remove the marked entities from done-filtered soup queries (inbox,
    // mail Important/Noise); views that show done content (e.g. mail All)
    // keep their rows. Undo restores them via this transaction's rollback.
    soupTxn =
      entityIds.length > 0
        ? removeSoupEntitiesFromDoneFilteredQueries(entityIdSet)
        : null;
    // Rows that remain visible flip to the done state.
    emailRowTxns = emailIds.map((id) =>
      optimisticUpdateSoupEntity({
        tag: 'emailThread',
        data: { id, inboxVisible: false },
        frecency_score: getSoupEntityById(id)?.frecency_score ?? 0,
      })
    );
    // Stamping `completedAt` is what drops a reminder out of the Active and
    // Scheduled tabs, both of which require `!entity.completedAt` — so this
    // takes effect before any refetch, whether or not it had already fired.
    reminderRowTxns = reminderIds.map((id) =>
      optimisticUpdateSoupEntity({
        tag: 'reminder',
        data: { id, completedAt: completedStamp },
        frecency_score: getSoupEntityById(id)?.frecency_score ?? 0,
      })
    );
    filterEmailCache();
    setDoneOverride(notificationIds, true);
  };

  const rollbackSoup = () => {
    for (const txn of [...reminderRowTxns].reverse()) {
      txn.rollback();
    }
    reminderRowTxns = [];
    for (const txn of [...emailRowTxns].reverse()) {
      txn.rollback();
    }
    emailRowTxns = [];
    soupTxn?.rollback();
    soupTxn = null;
  };

  const rollback = () => {
    rollbackSoup();
    restoreEmailCache();
    setDoneOverride(notificationIds, undefined);
  };

  const applyUndone = () => {
    rollbackSoup();
    restoreEmailCache();
    restoreUserNotifications(notificationSnapshots);
    // Force `done=false` — cache may have reconciled to `done=true` from the
    // server, so clearing the override would leave the UI hidden after undo.
    setDoneOverride(notificationIds, false);
  };

  reapply();

  return { rollback, reapply, applyUndone };
}

/**
 * Optimistic UI for marking entities as not done — flips email rows back to
 * inbox-visible and forces the notification `done` override off. Rows are
 * patched in place; done-filtered views regain the entities when the caller
 * invalidates after the server confirms.
 */
export function applyEntitiesNotDoneOptimistic(args: {
  emailIds: string[];
  notificationIds: string[];
  reminderIds?: string[];
}): { rollback: () => void } {
  const { emailIds, notificationIds, reminderIds = [] } = args;
  // Clearing `completedAt` is what returns a reminder to Active or Scheduled
  // (whichever its `nextRunAt` puts it in); both predicates require it unset.
  const reminderRowTxns = reminderIds.map((id) =>
    optimisticUpdateSoupEntity({
      tag: 'reminder',
      data: { id, completedAt: null },
      frecency_score: getSoupEntityById(id)?.frecency_score ?? 0,
    })
  );

  const emailRowTxns = emailIds.map((id) =>
    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id, inboxVisible: true },
      frecency_score: getSoupEntityById(id)?.frecency_score ?? 0,
    })
  );
  setDoneOverride(notificationIds, false);

  return {
    rollback: () => {
      for (const txn of [...reminderRowTxns].reverse()) {
        txn.rollback();
      }
      for (const txn of [...emailRowTxns].reverse()) {
        txn.rollback();
      }
      setDoneOverride(notificationIds, undefined);
    },
  };
}

/**
 * Flip the reminders' own `completed` column. One PATCH each — the reminders
 * API has no bulk endpoint, and a mark-done selection is normally one row.
 */
function setRemindersCompleted(
  reminderIds: string[],
  completed: boolean
): Promise<unknown>[] {
  return reminderIds.map((id) => setReminderCompleted(id, completed));
}

/**
 * Fires archive, selective ID-scoped notification, entity-scoped notification,
 * and reminder completion writes. Returns the authoritative notification IDs
 * produced by the entity write. Throws on any failure; the caller owns rollback
 * through the context returned by `applyEntitiesDoneOptimistic`.
 */
export async function executeMarkEntitiesDone(args: {
  emailIds: string[];
  notificationIds: string[];
  notificationEntities?: NotificationEntityRef[];
  reminderIds?: string[];
}): Promise<string[]> {
  const {
    emailIds,
    notificationIds,
    notificationEntities = [],
    reminderIds = [],
  } = args;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: notificationKeys.user._def }),
  ]);

  let authoritativeNotificationIds: string[] = [];
  const results = await Promise.allSettled([
    ...emailIds.map((id) =>
      throwOnErr(
        async () => await emailClient.flagArchived({ value: true, id })
      )
    ),
    notificationIds.length > 0
      ? bulkMarkNotificationsAsDone(notificationIds)
      : Promise.resolve(),
    notificationEntities.length > 0
      ? updateNotificationsForEntities({
          entities: notificationEntities,
          operation: 'MARK_DONE',
        }).then((notifications) => {
          authoritativeNotificationIds = notifications.map(
            (notification) => notification.id
          );
        })
      : Promise.resolve(),
    ...setRemindersCompleted(reminderIds, true),
  ]);

  const rejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );

  if (rejected) {
    // Real refetch to reconcile server state with the UI after the caller
    // rolls back its optimistic cache writes. `allSettled` means some
    // reminders may have been written even though the caller rolls all of
    // them back, so they have to be reconciled too, not just the emails.
    invalidateRemindersById(reminderIds, { refetch: true });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: notificationKeys.user._def }),
      ...emailIds.map((id) => invalidateSoupEntity(id)),
      ...reminderIds.map((id) => invalidateSoupEntity(id)),
    ]);
    throw rejected.reason ?? new Error('Failed to mark as done');
  }

  invalidateRemindersById(reminderIds);
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.all.email,
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    }),
    ...emailIds.map((id) => invalidateSoupEntity(id)),
  ]);

  return authoritativeNotificationIds;
}

/**
 * Fires the unarchive + bulk-undone APIs for the given ids. Throws on any
 * failure; caller is responsible for re-applying optimistic state.
 */
export async function executeMarkEntitiesUndone(args: {
  emailIds: string[];
  notificationIds: string[];
  reminderIds?: string[];
}): Promise<void> {
  const { emailIds, notificationIds, reminderIds = [] } = args;
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.all.email }),
    queryClient.cancelQueries({ queryKey: notificationKeys.user._def }),
  ]);

  const results = await Promise.allSettled([
    ...emailIds.map((id) =>
      throwOnErr(
        async () => await emailClient.flagArchived({ value: false, id })
      )
    ),
    notificationIds.length > 0
      ? bulkMarkNotificationsAsUndone(notificationIds)
      : Promise.resolve(),
    ...setRemindersCompleted(reminderIds, false),
  ]);

  const rejected = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );

  if (rejected) {
    // `allSettled`, so some of these may have succeeded even though the caller
    // rolls every optimistic transaction back. Reconcile both kinds against the
    // server or their Soup rows keep the state the rollback restored — an
    // unarchived thread would sit there still showing as done.
    invalidateRemindersById(reminderIds, { refetch: true });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.all.email }),
      queryClient.invalidateQueries({ queryKey: notificationKeys.user._def }),
      ...emailIds.map((id) => invalidateSoupEntity(id)),
      ...reminderIds.map((id) => invalidateSoupEntity(id)),
    ]);
    throw rejected.reason ?? new Error('Failed to undo');
  }

  invalidateRemindersById(reminderIds);

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.all.email,
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    }),
    // Refetch open thread views so the unarchive restores `inbox_visible`.
    ...emailIds.map((id) =>
      queryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(id).queryKey,
      })
    ),
  ]);
}
