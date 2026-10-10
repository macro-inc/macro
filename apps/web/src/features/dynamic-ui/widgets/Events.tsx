import { Agenda } from '@app/features/agent-cards/components/agenda';
import type { WidgetOf } from '../schema';

export type EventsProps = Omit<WidgetOf<'events'>, 'type'>;

/** Calendar events as an agenda, loaded from the viewer's own calendars. */
export function Events(props: EventsProps) {
  return <Agenda title={props.title} events={props.events} />;
}
