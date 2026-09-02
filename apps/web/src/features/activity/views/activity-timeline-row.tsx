import { Show } from 'solid-js';
import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import { changedPropertyId } from '../core/action-property';
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
  const definition = deps.propertyDefinition(() =>
    changedPropertyId(props.event.action)
  );

  return (
    <Show
      when={entityType()}
      fallback={
        <ActivityTimelineRowView
          event={props.event}
          actorName={props.actorName}
          showActor={props.showActor}
          propertyDefinition={definition()}
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
            propertyDefinition={definition()}
            rowProps={opener.handlers}
          />
        );
      }}
    </Show>
  );
}
