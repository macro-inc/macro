import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { Show } from 'solid-js';
import { actionAsPropertyChange, describeAction } from './describe-action';
import { PropertyChangeText } from './property-change';

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * The verb half of an activity row: property changes render their resolved
 * transition ("changed Status from … to …"), everything else the plain verb
 * phrase.
 */
export function ActionPhrase(props: {
  event: ActivityEvent;
  capitalize?: boolean;
}) {
  return (
    <Show
      when={actionAsPropertyChange(props.event.action)}
      fallback={
        props.capitalize
          ? capitalize(describeAction(props.event.action))
          : describeAction(props.event.action)
      }
    >
      {(change) => (
        <PropertyChangeText action={change()} capitalize={props.capitalize} />
      )}
    </Show>
  );
}
