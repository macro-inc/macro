import type { PropertyDefinitionDomain } from '@property/types';
import { Show } from 'solid-js';
import { describeAction } from '../core/describe-action';
import type { ActivityAction } from '../core/event';
import { PropertyChangeText } from './property-change';

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * The verb half of an activity row: property changes render their resolved
 * transition ("changed Status from … to …"), everything else the plain verb
 * phrase with the run `count` folded in ("made 5 edits").
 */
export function ActionPhrase(props: {
  action: ActivityAction;
  count?: number;
  propertyDefinition?: PropertyDefinitionDomain;
  capitalize?: boolean;
}) {
  return (
    <Show
      when={props.action.kind === 'property-changed' ? props.action : undefined}
      fallback={
        props.capitalize
          ? capitalize(describeAction(props.action, props.count))
          : describeAction(props.action, props.count)
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
