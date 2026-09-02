import type { PropertyDefinitionDomain } from '@property/types';
import { Show } from 'solid-js';
import { describeAction } from '../core/describe-action';
import type { ActivityEvent } from '../core/event';
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
  propertyDefinition?: PropertyDefinitionDomain;
  capitalize?: boolean;
}) {
  return (
    <Show
      when={
        props.event.action.kind === 'property-changed'
          ? props.event.action
          : undefined
      }
      fallback={
        props.capitalize
          ? capitalize(describeAction(props.event.action))
          : describeAction(props.event.action)
      }
    >
      {(change) => (
        <PropertyChangeText
          action={change()}
          definition={props.propertyDefinition}
          capitalize={props.capitalize}
        />
      )}
    </Show>
  );
}
