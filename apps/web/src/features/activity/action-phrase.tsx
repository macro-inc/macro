import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { Show } from 'solid-js';
import { actionAsPropertyChange, describeAction } from './describe-action';
import { PropertyChangeText } from './property-change';

/**
 * The verb half of an activity row: property changes render their resolved
 * transition ("changed Status from … to …"), everything else the plain verb
 * phrase.
 */
export function ActionPhrase(props: { event: ActivityEvent }) {
  return (
    <Show
      when={actionAsPropertyChange(props.event.action)}
      fallback={describeAction(props.event.action)}
    >
      {(change) => <PropertyChangeText action={change()} />}
    </Show>
  );
}
