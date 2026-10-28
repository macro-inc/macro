import { InspectorSelect } from './inspector-select';
/**
 * For a layer inside a main component: which component property drives
 * its visibility, its text, or (for a nested instance) which component it
 * shows, as Figma's "Apply component property" controls do, with "Create
 * property…" to make one from the layer; and, for nested instances,
 * whether their properties show on the component's instances.
 * Presentational: data and actions come in as props.
 */

import type {
  BindableField,
  LayerBindings,
} from '@core/fig-engine/design-types';
import { For, Show } from 'solid-js';
import { PROPERTY_KIND_LABELS } from '../core/design-system';
import { Section } from './panel-section';
import { PropertyRow } from './property-controls';

export interface BindingActions {
  onBind: (field: BindableField, property: string | undefined) => void;
  /** Makes a property from the layer's value and binds the field to it. */
  onCreate: (field: BindableField) => void;
  onExpose: (exposed: boolean) => void;
}

const FIELD_LABELS: Record<BindableField, string> = {
  VISIBLE: 'Visibility',
  TEXT: 'Text',
  INSTANCE_SWAP: 'Instance',
};

/** The menu value that creates a property instead of choosing one. */
const CREATE = '__create__';

export function BindingsSection(props: {
  bindings: LayerBindings;
  /** Absent when read-only. */
  actions?: BindingActions;
}) {
  const b = () => props.bindings;
  return (
    <Section title="Component properties" testId="fig-bindings-section">
      <For each={b().fields}>
        {(f) => (
          <PropertyRow label={FIELD_LABELS[f.field]}>
            <InspectorSelect
              label={FIELD_LABELS[f.field]}
              value={f.property ?? ''}
              disabled={!props.actions}
              testId={`fig-bind-${f.field}`}
              options={[
                { value: '', label: 'None' },
                ...b()
                  .properties.filter((p) => p.kind === f.kind)
                  .map((p) => ({ value: p.id, label: p.name })),
                {
                  value: CREATE,
                  label: `Create ${PROPERTY_KIND_LABELS[f.kind].toLowerCase()} property…`,
                },
              ]}
              onChange={(value) =>
                value === CREATE
                  ? props.actions?.onCreate(f.field)
                  : props.actions?.onBind(f.field, value || undefined)
              }
            />
          </PropertyRow>
        )}
      </For>
      <Show when={b().exposed !== null}>
        <label class="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={b().exposed ?? false}
            disabled={!props.actions}
            data-testid="fig-expose-instance"
            onChange={(e) => props.actions?.onExpose(e.currentTarget.checked)}
          />
          Expose its properties on instances
        </label>
      </Show>
    </Section>
  );
}
