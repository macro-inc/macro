import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import {
  type OpenEntityTarget,
  useActivityContext,
} from '../context/activity-context';
import { entryAction, entryHead, type FeedEntry } from '../core/collapse-runs';
import type { RailEnds } from '../core/feed-rows';
import { createEntityOpener } from '../primitives/entity-opener';

/**
 * Feed and tool row: presentational chrome plus the entity mention. Pass
 * `onOpen` to make the row click-to-open; leave it out for inert rows.
 */
export function ActivityTimelineRow(props: {
  entry: FeedEntry;
  actorName?: string;
  showActor?: boolean;
  rail?: RailEnds;
  onOpen?: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const head = () => entryHead(props.entry);
  const opener = createEntityOpener(
    context,
    () => head().entityId,
    () => head().entityType,
    props.onOpen
  );
  const definition = context.propertyDefinition(() => {
    const action = entryAction(props.entry);
    return action.kind === 'property-changed' ? action.property : undefined;
  });

  return (
    <ActivityTimelineRowView
      entry={props.entry}
      actorName={props.actorName}
      showActor={props.showActor}
      rail={props.rail}
      display={opener()?.display}
      rowProps={opener()?.handlers}
      propertyDefinition={definition()}
    />
  );
}
