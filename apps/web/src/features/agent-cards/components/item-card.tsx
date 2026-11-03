import { Match, Switch } from 'solid-js';
import type { CardItem } from '../core/types';
import { EventCard } from './event-card';
import { ReferenceCard } from './reference-card';
import { RoutineCard } from './routine-card';

/**
 * The card for a workspace item, by what kind of item it is: a calendar
 * page for an event, a routine with its schedule and controls, an icon tile
 * for everything else.
 */
export function ItemCard(props: { item: CardItem }) {
  return (
    <Switch>
      <Match when={props.item.type === 'calendar_event'}>
        <EventCard
          eventId={props.item.id}
          occurrenceKey={props.item.occurrenceKey}
        />
      </Match>
      <Match when={props.item.type === 'routine'}>
        <RoutineCard id={props.item.id} />
      </Match>
      <Match
        when={
          props.item.type !== 'calendar_event' ? props.item.type : undefined
        }
      >
        {(type) => (
          <ReferenceCard
            type={type()}
            id={props.item.id}
            fileType={props.item.fileType}
          />
        )}
      </Match>
    </Switch>
  );
}
