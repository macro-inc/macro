import { InspectorSelect } from './inspector-select';
/**
 * The design panel section for a main component, component set, or
 * variant: its variant properties (renamed, removed, or, on a variant, its
 * values), "Add variant", and its boolean, text, and instance swap
 * properties with their defaults ("Create component property" through
 * "+"). Presentational: data and actions come in as props.
 */

import type {
  ComponentPanel,
  PropertyKind,
} from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import Minus from '@phosphor/minus.svg';
import Plus from '@phosphor/plus.svg';
import { createSignal, For, Show } from 'solid-js';
import {
  defaultPropertyName,
  PROPERTY_KIND_LABELS,
  type PropertyInput,
} from '../core/design-system';
import { TextField } from './design-fields';
import { Section } from './panel-section';
import { PropertyRow, PropertyValueControl } from './property-controls';

export interface ComponentActions {
  onCreateProperty: (kind: PropertyKind | 'VARIANT', name: string) => void;
  onRenameProperty: (property: string, name: string) => void;
  onSetDefault: (property: string, value: PropertyInput) => void;
  onDeleteProperty: (property: string) => void;
  onRenameVariantProperty: (from: string, to: string) => void;
  onRemoveVariantProperty: (name: string) => void;
  onSetVariantValue: (property: string, value: string) => void;
  onAddVariant: () => void;
}

const slug = (name: string) => name.replace(/\s+/g, '-');

function IconButton(props: {
  label: string;
  testId?: string;
  onClick: () => void;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
      data-testid={props.testId}
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

/** "Create component property": a kind and a name. */
function NewProperty(props: {
  taken: string[];
  allowVariant: boolean;
  onCreate: (kind: PropertyKind | 'VARIANT', name: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = createSignal<PropertyKind | 'VARIANT'>('BOOL');
  const [name, setName] = createSignal<string>();
  const shown = () => name() ?? defaultPropertyName(kind(), props.taken);
  const create = () => props.onCreate(kind(), shown().trim());
  return (
    <div
      class="flex flex-col gap-1.5 rounded-md bg-inset p-2"
      data-testid="fig-new-property"
    >
      <InspectorSelect
        label="Property type"
        value={kind()}
        testId="fig-new-property-kind"
        options={(
          (props.allowVariant
            ? ['VARIANT', 'BOOL', 'TEXT', 'INSTANCE_SWAP']
            : ['BOOL', 'TEXT', 'INSTANCE_SWAP']) as (PropertyKind | 'VARIANT')[]
        ).map((value) => ({ value, label: PROPERTY_KIND_LABELS[value] }))}
        onChange={setKind}
      />
      <input
        class="rounded-md bg-panel px-1.5 py-0.5 text-ink outline-none"
        value={shown()}
        data-testid="fig-new-property-name"
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') props.onCancel();
        }}
      />
      <div class="flex justify-end gap-1">
        <button
          type="button"
          class="rounded-md px-2 py-0.5 text-ink-muted hover:bg-hover"
          onClick={() => props.onCancel()}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded-md bg-accent px-2 py-0.5 text-accent-contrast"
          data-testid="fig-new-property-create"
          onClick={create}
        >
          Create property
        </button>
      </div>
    </div>
  );
}

export function ComponentSection(props: {
  panel: ComponentPanel;
  components: readonly ComponentInfo[];
  /** Absent when read-only. */
  actions?: ComponentActions;
}) {
  const p = () => props.panel;
  const [creating, setCreating] = createSignal(false);
  const title = () =>
    p().isSet ? 'Component set' : p().isVariant ? 'Variant' : 'Component';
  const taken = () => [
    ...p().properties.map((d) => d.name),
    ...p().variantProperties.map((v) => v.name),
  ];
  return (
    <Section
      title={title()}
      testId="fig-component-section"
      onAdd={props.actions ? () => setCreating(true) : undefined}
    >
      <Show when={creating() && props.actions}>
        {(actions) => (
          <NewProperty
            taken={taken()}
            allowVariant
            onCancel={() => setCreating(false)}
            onCreate={(kind, name) => {
              const create = actions().onCreateProperty;
              setCreating(false);
              create(kind, name);
            }}
          />
        )}
      </Show>
      <For each={p().variantProperties}>
        {(v) => (
          <Show
            when={props.actions}
            fallback={
              <PropertyRow label={v.name}>
                <span class="block truncate text-ink">
                  {v.value ?? v.values.join(', ')}
                </span>
              </PropertyRow>
            }
          >
            {(actions) => (
              <Show
                when={p().isVariant}
                fallback={
                  <div class="flex min-w-0 items-center gap-1">
                    <TextField
                      value={v.name}
                      class="w-20 shrink-0 bg-inset"
                      testId={`fig-variant-property-${slug(v.name)}`}
                      onChange={(name) =>
                        actions().onRenameVariantProperty(v.name, name)
                      }
                    />
                    <span
                      class="min-w-0 flex-1 truncate text-ink-muted"
                      title={v.values.join(', ')}
                    >
                      {v.values.join(', ')}
                    </span>
                    <IconButton
                      label={`Remove ${v.name}`}
                      testId={`fig-variant-property-remove-${slug(v.name)}`}
                      onClick={() => actions().onRemoveVariantProperty(v.name)}
                    >
                      <Minus class="size-3" />
                    </IconButton>
                  </div>
                }
              >
                <PropertyRow label={v.name}>
                  <TextField
                    value={v.value ?? ''}
                    class="w-full bg-inset"
                    testId={`fig-variant-value-${slug(v.name)}`}
                    onChange={(value) =>
                      actions().onSetVariantValue(v.name, value)
                    }
                  />
                </PropertyRow>
              </Show>
            )}
          </Show>
        )}
      </For>
      <Show when={props.actions}>
        {(actions) => (
          <button
            type="button"
            class="flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            data-testid="fig-add-variant"
            onClick={() => actions().onAddVariant()}
          >
            <Plus class="size-3" />
            Add variant
          </button>
        )}
      </Show>
      <For each={p().properties}>
        {(d) => (
          <div
            class="flex flex-col gap-1 rounded-md border border-edge-muted p-1.5"
            data-testid="fig-component-property"
          >
            <div class="flex min-w-0 items-center gap-1">
              <Show
                when={props.actions}
                fallback={
                  <span class="flex-1 truncate text-ink">{d.name}</span>
                }
              >
                {(actions) => (
                  <TextField
                    value={d.name}
                    class="min-w-0 flex-1"
                    testId={`fig-property-name-${slug(d.name)}`}
                    onChange={(name) => actions().onRenameProperty(d.id, name)}
                  />
                )}
              </Show>
              <span class="shrink-0 text-ink-muted">
                {PROPERTY_KIND_LABELS[d.kind]}
              </span>
              <Show when={props.actions}>
                {(actions) => (
                  <IconButton
                    label={`Delete ${d.name}`}
                    testId={`fig-property-delete-${slug(d.name)}`}
                    onClick={() => actions().onDeleteProperty(d.id)}
                  >
                    <Minus class="size-3" />
                  </IconButton>
                )}
              </Show>
            </div>
            <PropertyRow label="Default">
              <PropertyValueControl
                kind={d.kind}
                value={d.default}
                disabled={!props.actions}
                testId={`fig-property-default-${slug(d.name)}`}
                components={props.components}
                onChange={(value) => props.actions?.onSetDefault(d.id, value)}
              />
            </PropertyRow>
            <span class="text-ink-muted">
              {d.bound === 1 ? '1 layer' : `${d.bound} layers`}
            </span>
          </div>
        )}
      </For>
    </Section>
  );
}
