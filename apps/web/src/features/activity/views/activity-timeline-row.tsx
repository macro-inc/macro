import { Show } from 'solid-js';
import { type ActivityEvent, toPropertyEntityType } from '../domain/event';
import { ActivityTimelineRow as ActivityTimelineRowView } from '../ui/activity-timeline-row';
import { OpenEntity } from './open-entity';

/** Feed and tool row: presentational chrome plus click-to-open. */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  showActor?: boolean;
}) {
  const entityType = () => toPropertyEntityType(props.event.entityType);

  return (
    <Show
      when={entityType()}
      fallback={
        <ActivityTimelineRowView
          event={props.event}
          actorName={props.actorName}
          showActor={props.showActor}
        />
      }
    >
      {(type) => (
        <OpenEntity entityId={props.event.entityId} entityType={type()}>
          {({ display, handlers }) => (
            <ActivityTimelineRowView
              event={props.event}
              actorName={props.actorName}
              showActor={props.showActor}
              display={display}
              rowProps={handlers}
            />
          )}
        </OpenEntity>
      )}
    </Show>
  );
}
