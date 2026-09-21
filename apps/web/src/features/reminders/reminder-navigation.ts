import { buildSimpleEntityUrl } from '@core/util/url';

export const REMINDER_DETAIL_COMPONENT_PREFIX = 'reminder-view~';

/** The restorable split id used by every reminder-detail entry point. */
export function reminderDetailComponentId(reminderId: string): string {
  return `${REMINDER_DETAIL_COMPONENT_PREFIX}${reminderId}`;
}

/** Parse a reminder id from a restored reminder-detail component id. */
export function reminderIdFromDetailComponent(
  componentId: string
): string | undefined {
  if (!componentId.startsWith(REMINDER_DETAIL_COMPONENT_PREFIX)) {
    return undefined;
  }
  const reminderId = componentId.slice(REMINDER_DETAIL_COMPONENT_PREFIX.length);
  return reminderId || undefined;
}

/** A reminder always opens its details first; source navigation lives there. */
export type ReminderDetailDestination = {
  kind: 'reminder-detail';
  reminderId: string;
  content: {
    type: 'component';
    id: string;
  };
};

export function reminderDetailDestination(
  reminderId: string
): ReminderDetailDestination {
  return {
    kind: 'reminder-detail',
    reminderId,
    content: {
      type: 'component',
      id: reminderDetailComponentId(reminderId),
    },
  };
}

/** The canonical, reload-safe URL copied for a reminder. */
export function reminderDetailUrl(reminderId: string): string {
  return buildSimpleEntityUrl({
    type: 'component',
    id: reminderDetailComponentId(reminderId),
  });
}
