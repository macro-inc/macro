import type { Accessor } from 'solid-js';
import { CallSidebar as Content } from '../components/call-sidebar';
import type {
  CallSidebarActions,
  CallSidebarSources,
} from '../context/call-sidebar';
import type { UpcomingCalendarEvent } from '../core/upcoming-calendar-events';
import { isCalendarEventOngoing } from '../core/upcoming-calendar-events';

export function CallSidebar(props: {
  sources: CallSidebarSources;
  actions: CallSidebarActions;
  now: Accessor<Date>;
  when: (call: UpcomingCalendarEvent) => string;
}) {
  return (
    <Content
      active={props.sources.active.calls()}
      upcoming={props.sources.upcoming.events().slice(0, 5)}
      upcomingLoading={props.sources.upcoming.loading()}
      activeError={props.sources.active.error()}
      upcomingError={props.sources.upcoming.error()}
      canJoin={(event) =>
        Boolean(event.url) && isCalendarEventOngoing(event, props.now())
      }
      onOpenEvent={props.actions.openEvent}
      when={props.when}
      onJoin={props.actions.join}
      onRetryActive={props.sources.active.refresh}
      onRetryUpcoming={props.sources.upcoming.refresh}
    />
  );
}
