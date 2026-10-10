import { Match, Switch } from 'solid-js';
import type { CardAction, CardItem } from '../core/types';
import { EntityCard } from './entity-card';
import { EventCard } from './event-card';

/** The card for a workspace item, by what kind of item it is. */
export function ItemCard(props: {
  item: CardItem;
  action?: CardAction;
  /** The item's name as the agent knew it, until it loads. */
  title?: string | null;
}) {
  return (
    <Switch>
      <Match when={props.item.type === 'calendar_event'}>
        <EventCard
          eventId={props.item.id}
          occurrenceKey={props.item.occurrenceKey}
          action={props.action}
          title={props.title}
        />
      </Match>
      <Match
        when={
          props.item.type !== 'calendar_event' ? props.item.type : undefined
        }
      >
        {(type) => (
          <EntityCard
            type={type()}
            id={props.item.id}
            fileType={props.item.fileType}
            action={props.action}
            title={props.title}
          />
        )}
      </Match>
    </Switch>
  );
}
