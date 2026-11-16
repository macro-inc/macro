import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { needsCalendarReply } from '@app/features/calendar/core/needs-reply';
import { createCallSidebarClock } from '@app/features/meetings/primitives/call-sidebar';
import { useUpcomingCalendarEventsSource } from '@app/features/meetings/queries/upcoming-calendar-events';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useUserId } from '@core/context/user';
import { RSVP_MUTATION_KEY } from '@queries/calendar/keys';
import { Key } from '@solid-primitives/keyed';
import { useIsMutating } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { createNeedsReplyRows } from '../../primitives/create-needs-reply-rows';
import { NeedsReplyRow } from './NeedsReplyRow';

/** Replaces Calendar's upcoming list without mounting another rolling reader beside it. */
export function NeedsReplyList() {
  const calendar = useCalendarView();
  const account = useUserId();
  const now = createCallSidebarClock();
  const source = useUpcomingCalendarEventsSource({
    userId: account,
    sourceById: calendar.sourceById,
    sourcesReady: calendar.sourcesReady,
    isSourceVisible: calendar.isSourceVisible,
    now,
    includeEvent: needsCalendarReply,
  });
  usePending(
    'calendar.needs-reply',
    () => Boolean(account()) && source.loading()
  );
  const responding = useIsMutating(() => ({ mutationKey: RSVP_MUTATION_KEY }));
  const invitations = createMemo(() =>
    source
      .events()
      .slice(0, 5)
      .flatMap((item) => {
        const event = source.findEvent(item.id);
        return event ? [event] : [];
      })
  );
  const rows = createNeedsReplyRows({
    account,
    events: invitations,
    findEvent: source.findEvent,
    pending: () => responding() > 0,
  });

  return (
    <>
      <Switch>
        <Match when={rows().length > 0}>
          <ul class="flex flex-col gap-1">
            <Key each={rows()} by="id">
              {(event) => <NeedsReplyRow event={event()} />}
            </Key>
          </ul>
        </Match>
        <Match when={source.loading() && !source.error()}>
          <p role="status" class="px-2 py-3 text-xs text-ink-muted">
            {t('calendar.needsReplyLoading')}
          </p>
        </Match>
        <Match when={!source.error()}>
          <p class="px-2 py-3 text-xs text-ink-muted">
            {t('calendar.needsReplyEmpty')}
          </p>
        </Match>
      </Switch>
      <Show when={source.error()}>
        <div class="px-2 py-2 text-xs">
          <p role="alert" class="text-failure">
            {t('calendar.needsReplyError')}
          </p>
          <Button variant="ghost" size="sm" onClick={source.refresh}>
            {t('calendar.retry')}
          </Button>
        </div>
      </Show>
    </>
  );
}
