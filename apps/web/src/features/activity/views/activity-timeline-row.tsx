import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import type { ActivityEvent } from '../core/event';
import { type OpenEntityTarget, useActivityDeps } from '../deps';
import { createEntityOpener } from '../state/entity-opener';

/**
 * Feed and tool row: presentational chrome plus the entity mention. Pass
 * `onOpen` to make the row click-to-open; leave it out for inert rows.
 */
export function ActivityTimelineRow(props: {
  event: ActivityEvent;
  actorName?: string;
  showActor?: boolean;
  onOpen?: (target: OpenEntityTarget) => void;
}) {
  const deps = useActivityDeps();
  const opener = createEntityOpener(
    deps,
    () => props.event.entityId,
    () => props.event.entityType,
    props.onOpen
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
