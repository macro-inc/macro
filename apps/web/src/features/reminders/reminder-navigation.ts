import type { SplitRouter } from '@app/lib/split-router';
import { globalSplitManager, globalSplitRouter } from '@app/signal/splitLayout';
import type {
  ReferredFrom,
  SplitContent,
  SplitHandle,
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import { buildSimpleEntityUrl } from '@core/util/url';

export const REMINDER_DETAIL_ROUTE_ID = 'reminder-detail';
export const HOME_REMINDER_DETAIL_ROUTE_ID = 'home-reminder-detail';
export const REMINDER_DETAIL_COMPONENT_ID = 'reminder-detail';
export const LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX = 'reminder-view~';

/** Parse the reminder id carried by a pre-route reminder component link. */
export function reminderIdFromLegacyComponent(
  componentId: string
): string | undefined {
  if (!componentId.startsWith(LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX)) return;
  const reminderId = componentId.slice(
    LEGACY_REMINDER_DETAIL_COMPONENT_PREFIX.length
  );
  return reminderId || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  return value as Record<string, unknown>;
}

/** Reminder identity from either current route metadata or legacy content. */
export function reminderIdFromDetailContent(
  content: SplitContent
): string | undefined {
  if (content.type !== 'component') return;

  const legacyId = reminderIdFromLegacyComponent(content.id);
  if (legacyId) return legacyId;

  const metadata = record(content.entryMetadata);
  const location = record(metadata?.location) ?? metadata;
  const route = record(location?.route);
  const matches = route?.matches;
  if (Array.isArray(matches)) {
    for (const match of matches) {
      const value = record(match);
      if (
        value?.id !== REMINDER_DETAIL_ROUTE_ID &&
        value?.id !== HOME_REMINDER_DETAIL_ROUTE_ID
      ) {
        continue;
      }
      const reminderId = record(value.params)?.reminderId;
      if (typeof reminderId === 'string' && reminderId.length > 0) {
        return reminderId;
      }
    }
  }

  // The router may preserve shell params while replacing this fixed component
  // from reminder A to B. Route metadata is authoritative when present; params
  // are only the startup/legacy fallback before the route host is available.
  if (content.id === REMINDER_DETAIL_COMPONENT_ID) {
    const reminderId = record(content.params)?.reminderId;
    if (typeof reminderId === 'string' && reminderId.length > 0) {
      return reminderId;
    }
  }
}

/** Route-backed split content for the standalone reminder detail. */
export function reminderDetailContent(reminderId: string): SplitContent {
  return {
    type: 'component',
    id: REMINDER_DETAIL_COMPONENT_ID,
    params: { reminderId },
    entryMetadata: {
      route: {
        matches: [{ id: REMINDER_DETAIL_ROUTE_ID, params: { reminderId } }],
      },
    },
  };
}

/** A reminder always opens its details first; source navigation lives there. */
export type ReminderDetailDestination = {
  kind: 'reminder-detail';
  reminderId: string;
  content: SplitContent;
};

export function reminderDetailDestination(
  reminderId: string
): ReminderDetailDestination {
  return {
    kind: 'reminder-detail',
    reminderId,
    content: reminderDetailContent(reminderId),
  };
}

/** The canonical, reload-safe URL copied for a reminder. */
export function reminderDetailUrl(reminderId: string): string {
  return buildSimpleEntityUrl({
    type: 'reminder',
    id: encodeURIComponent(reminderId),
  });
}

/** The app-relative path consumed by Split Router. */
export function reminderDetailPath(reminderId: string): string {
  return `/reminder/${encodeURIComponent(reminderId)}`;
}

/**
 * Open a reminder through its route-backed lightweight component.
 *
 * Split Router owns reminder identity through the route claim. The contained
 * manager fallback exists only for startup/tests before the route host is
 * registered; it applies the same exact-reminder rule to route and legacy
 * content.
 */
export function openReminderDetail(
  reminderId: string,
  options: {
    manager?: SplitManager;
    handle?: SplitHandle;
    openInNewSplit?: boolean;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
    router?: Pick<SplitRouter<SplitId>, 'navigate'>;
  } = {}
): void {
  const manager = options.manager ?? globalSplitManager();
  if (!manager) return;

  const router = options.router ?? globalSplitRouter();
  const sourceId = options.handle?.id ?? manager.activeSplitId();
  if (router && sourceId) {
    router.navigate(sourceId, reminderDetailPath(reminderId), {
      replace: options.mergeHistory,
      target: options.openInNewSplit ? 'new-split' : 'current',
    });
    return;
  }

  // Route-backed opens wait reactively for flag hydration. This fallback has
  // no route component to enforce the flag, so it may only mount content from
  // an already-enabled snapshot. Startup notification intents wait for the
  // router separately instead of reaching this branch while flags load.
  if (!isFeatureEnabled(enableReminders)) return;

  const existingState = manager
    .splits()
    .find((split) => reminderIdFromDetailContent(split.content) === reminderId);
  const existing = existingState
    ? manager.getSplit(existingState.id)
    : undefined;
  if (existing) {
    existing.activate();
    return;
  }

  manager.openWithSplit(reminderDetailContent(reminderId), {
    activate: true,
    allowDuplicate: true,
    preferNewSplit: options.openInNewSplit,
    handle: options.handle,
    mergeHistory: options.mergeHistory,
    referredFrom: options.referredFrom ?? null,
  });
}
