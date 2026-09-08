import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import {
  type OpenEntityTarget,
  useActivityContext,
} from '../context/activity-context';
import type { ActivityEvent } from '../core/event';
import { createEntityOpener } from '../primitives/entity-opener';

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
  const context = useActivityContext();
  const opener = createEntityOpener(
    context,
    () => props.event.entityId,
    () => props.event.entityType,
    props.onOpen
  );
  const definition = context.propertyDefinition(() => {
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
