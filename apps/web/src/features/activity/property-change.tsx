import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { TagDot } from '@property/tags/TagDot';
import type { PropertyDefinitionDomain } from '@property/types';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { For, Show } from 'solid-js';
import {
  propertyValueLabel,
  selectOptionEntries,
} from './property-change-label';

type PropertyChangedAction = Extract<
  ActivityEvent['action'],
  { __typename: 'GraphqlActivityPropertyChanged' }
>;

/**
 * "changed Status: In Progress → Completed" — the property-changed verb
 * phrase with the definition name and value labels resolved. Select values
 * render as the property system's option pills (system option icons, tag
 * colors); scalars render as text. Falls back word by word: unknown
 * definition → "a property", unlabelable values → plain "changed"/"cleared"
 * wording. `from` is rendered only when the source event carried it (most
 * producers don't yet).
 */
export function PropertyChangeText(props: { action: PropertyChangedAction }) {
  const definitions = useAllProperties();
  const definition = () =>
    definitions().find((def) => def.id === props.action.property);
  const name = () => definition()?.displayName ?? 'a property';
  const cleared = () =>
    props.action.to === null || props.action.to === undefined;
  const hasFrom = () =>
    propertyValueLabel(props.action.from, definition()) !== undefined;
  const hasTo = () =>
    !cleared() &&
    propertyValueLabel(props.action.to, definition()) !== undefined;

  return (
    <span class="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
      <span class="shrink-0">{cleared() ? 'cleared' : 'changed'}</span>
      <span class="shrink-0 font-medium text-ink">{name()}</span>
      <Show when={hasFrom()}>
        <span class="shrink-0">from</span>
        <PropertyValueDisplay
          raw={props.action.from}
          definition={definition()}
        />
      </Show>
      <Show when={hasTo()}>
        <span class="shrink-0">to</span>
        <PropertyValueDisplay raw={props.action.to} definition={definition()} />
      </Show>
    </span>
  );
}

/**
 * One stored property value: select options as the house option pills
 * (system option icon or tag color dot + label), everything else as text.
 */
function PropertyValueDisplay(props: {
  raw: unknown;
  definition: PropertyDefinitionDomain | undefined;
}) {
  const options = () => selectOptionEntries(props.raw, props.definition);

  return (
    <Show
      when={options()}
      fallback={
        <span class="min-w-0 truncate font-medium text-ink">
          {propertyValueLabel(props.raw, props.definition)}
        </span>
      }
    >
      {(entries) => (
        <span class="inline-flex min-w-0 flex-wrap items-center gap-1">
          <For each={entries()}>
            {(entry) => (
              <span class="inline-flex min-w-0 max-w-[20ch] items-center gap-1 rounded-full px-1.5 py-0.5 text-ink text-xs leading-tight ring ring-edge-muted/50 ring-inset">
                <PropertyValueIcon
                  optionId={entry.id}
                  class="size-3 shrink-0"
                />
                <Show when={entry.color}>
                  {(color) => <TagDot color={color()} class="size-2" />}
                </Show>
                <span class="truncate">{entry.label}</span>
              </span>
            )}
          </For>
        </span>
      )}
    </Show>
  );
}
