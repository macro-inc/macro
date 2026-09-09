import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableCalendarUi,
  enableInboxNotifiedSort,
  enableReminders,
  enableSnippets,
  enableSupportedSoupForeignEntities,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { type EntityData, isSnippetEntity } from '@entity';
import type { NotificationSource } from '@notifications';
import { startOfDay, subWeeks } from 'date-fns';
import { match } from 'ts-pattern';
import {
  noiseFilter,
  signalFilter,
} from '../../next-soup/filters/inbox-filters';
import {
  notDoneFilter,
  scheduledRemindersFilter,
} from '../../next-soup/filters/predicates';
import type { InboxQueryCapabilities, InboxViewContext } from './inbox-query';
import { inboxSortTimestamp } from './inbox-results';

export function useInboxQueryCapabilities() {
  const foreignEntities = useFeatureFlag(enableSupportedSoupForeignEntities);
  const notifiedSort = useFeatureFlag(enableInboxNotifiedSort);
  return (): InboxQueryCapabilities => ({
    calendar: isFeatureEnabled(enableCalendarUi),
    foreignEntities: foreignEntities().enabled,
    notifiedSort: notifiedSort().enabled,
    reminders: isFeatureEnabled(enableReminders),
    snippets: isFeatureEnabled(enableSnippets),
  });
}

function matchesCapabilities(
  entity: EntityData,
  capabilities: InboxQueryCapabilities
): boolean {
  if (entity.type === 'calendar_event') return capabilities.calendar;
  if (entity.type === 'foreign') return capabilities.foreignEntities;
  if (entity.type === 'reminder') return capabilities.reminders;
  if (isSnippetEntity(entity)) return capabilities.snippets;
  return true;
}

/** Shared row eligibility for the Inbox list and its badge, before admission. */
export function selectInboxEntities(
  entities: EntityData[],
  context: Pick<InboxViewContext, 'tab' | 'capabilities'>,
  source: NotificationSource
) {
  return entities
    .filter((entity) => matchesCapabilities(entity, context.capabilities))
    .map((entity) =>
      withEntityNotifications(entity, source, { scopeChannelThreads: true })
    )
    .filter((entity) =>
      match(context.tab)
        .with('signal', () => {
          if (!signalFilter(entity) || !notDoneFilter(source)(entity))
            return false;
          if (
            entity.type !== 'document' &&
            entity.type !== 'email' &&
            entity.type !== 'chat' &&
            entity.type !== 'project'
          ) {
            return true;
          }
          return (
            new Date(inboxSortTimestamp(entity) ?? 0).getTime() >=
            subWeeks(startOfDay(new Date()), 2).getTime()
          );
        })
        .with(
          'noise',
          () => noiseFilter(entity) && notDoneFilter(source)(entity)
        )
        .with('reminders', () => scheduledRemindersFilter(entity))
        .exhaustive()
    );
}
