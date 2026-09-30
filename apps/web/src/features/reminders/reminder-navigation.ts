import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  OpenSplitResult,
  ReferredFrom,
  SplitContent,
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { buildSimpleEntityUrl } from '@core/util/url';

export const REMINDER_DETAIL_ROUTE_ID = 'reminder-detail';
export const HOME_REMINDER_DETAIL_ROUTE_ID = 'home-reminder-detail';
export const REMINDER_DETAIL_COMPONENT_ID = 'reminder-detail';

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  return value as Record<string, unknown>;
}

/** Reminder identity from current standalone or Home route metadata. */
export function reminderIdFromDetailContent(
  content: SplitContent
): string | undefined {
  if (content.type !== 'component') return;

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
  // are only the startup fallback before the route host is available.
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
 * Split Manager delegates route-owned content to the app navigator, so the
 * reminder claim controls reuse across standalone and Home locations without a
 * second router owner.
 */
export function openReminderDetail(
  reminderId: string,
  options: {
    manager?: SplitManager;
    handle?: SplitHandle;
    openInNewSplit?: boolean;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
    onApplied?: VoidFunction;
  } = {}
): OpenSplitResult {
  const manager = options.manager ?? globalSplitManager();
  if (!manager) return { status: 'unavailable' };

  return manager.openWithSplit(reminderDetailContent(reminderId), {
    activate: true,
    preferNewSplit: options.openInNewSplit,
    handle: options.handle,
    mergeHistory: options.mergeHistory,
    referredFrom: options.referredFrom ?? null,
    search: {},
    onApplied: options.onApplied,
  });
}
