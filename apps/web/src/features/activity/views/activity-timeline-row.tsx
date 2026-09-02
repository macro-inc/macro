import { Show } from 'solid-js';
import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import { type ActivityEvent, toPropertyEntityType } from '../core/event';
import { useActivityDeps } from '../deps';
import { createEntityOpener } from '../state/entity-opener';

/** Feed and tool row: presentational chrome plus click-to-open. */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  showActor?: boolean;
}) {
  const deps = useActivityDeps();
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
      {(type) => {
        const opener = createEntityOpener(
          deps,
          () => props.event.entityId,
          type
        );
        return (
          <ActivityTimelineRowView
            event={props.event}
            actorName={props.actorName}
            showActor={props.showActor}
            display={opener.display}
            rowProps={opener.handlers}
          />
        );
      }}
    </Show>
  );
}
