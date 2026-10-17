import { Match, Switch } from 'solid-js';
import type { CardAction, CardItem } from '../core/types';
import { EventCard } from './event-card';
import { ReferenceCard } from './reference-card';
import { RoutineCard } from './routine-card';

/**
 * The card for a workspace item, by what kind of item it is: a calendar
 * page for an event, a routine with its schedule and controls, an icon tile
 * for everything else.
 */
export function ItemCard(props: {
  item: CardItem;
  action?: CardAction;
  /** The item's name as the agent knew it, until it loads. */
  title?: string | null;
  /** What happened to it, in a few words. */
  summary?: string | null;
}) {
  return (
    <Switch>
      <Match when={props.item.type === 'calendar_event'}>
        <EventCard
          eventId={props.item.id}
          occurrenceKey={props.item.occurrenceKey}
          action={props.action}
          title={props.title}
          summary={props.summary}
        />
      </Match>
      <Match when={props.item.type === 'routine'}>
        <RoutineCard
          id={props.item.id}
          action={props.action}
          title={props.title}
          summary={props.summary}
        />
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
            action={props.action}
            title={props.title}
            summary={props.summary}
          />
        )}
      </Match>
    </Switch>
  );
}
