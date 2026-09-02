import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import type { ActivityEvent } from '../core/event';
import { useActivityDeps } from '../deps';
import { createEntityOpener } from '../state/entity-opener';

/** Feed and tool row: presentational chrome plus click-to-open. */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  showActor?: boolean;
}) {
  const deps = useActivityDeps();
  const opener = createEntityOpener(
    deps,
    () => props.event.entityId,
    () => props.event.entityType
  );
  const definition = deps.propertyDefinition(() => {
    const action = props.event.action;
    return action.kind === 'property-changed' ? action.property : undefined;
  });

  return (
    <ActivityTimelineRowView
      event={props.event}
      actorName={props.actorName}
      showActor={props.showActor}
      display={opener()?.display}
      rowProps={opener()?.handlers}
      propertyDefinition={definition()}
    />
  );
}
