import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { Show } from 'solid-js';
import { propertyValueLabel } from './property-change-label';

type PropertyChangedAction = Extract<
  ActivityEvent['action'],
  { __typename: 'GraphqlActivityPropertyChanged' }
>;

/**
 * "changed Status: In Progress → Completed" — the property-changed verb
 * phrase with the definition name and value labels resolved. Falls back
 * word by word: unknown definition → "a property", unlabelable values →
 * plain "changed"/"cleared" wording. `from` is rendered only when the
 * source event carried it (most producers don't yet).
 */
export function PropertyChangeText(props: { action: PropertyChangedAction }) {
  const definitions = useAllProperties();
  const definition = () =>
    definitions().find((def) => def.id === props.action.property);
  const name = () => definition()?.displayName ?? 'a property';
  const fromLabel = () => propertyValueLabel(props.action.from, definition());
  const toLabel = () =>
    props.action.to === null || props.action.to === undefined
      ? undefined
      : propertyValueLabel(props.action.to, definition());
  const cleared = () =>
    props.action.to === null || props.action.to === undefined;

  return (
    <span class="min-w-0 truncate">
      {cleared() ? 'cleared ' : 'changed '}
      <span class="font-medium text-ink">{name()}</span>
      <Show when={fromLabel()}>
        {(label) => (
          <>
            {' from '}
            <span class="font-medium text-ink">{label()}</span>
          </>
        )}
      </Show>
      <Show when={toLabel()}>
        {(label) => (
          <>
            {' to '}
            <span class="font-medium text-ink">{label()}</span>
          </>
        )}
      </Show>
    </span>
  );
}
