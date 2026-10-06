import { InspectorSelect } from './inspector-select';
/**
 * The instance section of the design panel, as Figma shows it for a
 * selected instance: its main component (with "Go to main component"),
 * "Swap instance", "Reset all changes", its variant properties as menus,
 * boolean properties as toggles, text properties as fields, instance swap
 * properties as component pickers, and the same for exposed nested
 * instances. Presentational: data and actions come in as props.
 */

import type {
  InstanceInfo,
  InstanceProperties,
} from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import Swap from '@phosphor/swap.svg';
import { For, Show } from 'solid-js';
import type { PropertyInput } from '../core/design-system';
import { ComponentPicker } from './component-picker';
import { Section } from './panel-section';
import { PropertyRow, PropertyValueControl } from './property-controls';

export interface InstanceActions {
  onGoToMain: () => void;
  /** Absent when read-only. */
  onSetProperty?: (id: string, property: string, value: PropertyInput) => void;
  onReset?: (id: string, property?: string) => void;
  onSwap?: (id: string, component: string) => void;
}

const slug = (name: string) => name.replace(/\s+/g, '-');

function Properties(props: {
  instance: InstanceProperties;
  components: readonly ComponentInfo[];
  actions: InstanceActions;
}) {
  const id = () => props.instance.id;
  const set = props.actions.onSetProperty;
  return (
    <>
      <For each={props.instance.variants}>
        {(v) => (
          <PropertyRow label={v.name}>
            <InspectorSelect
              label={v.name}
              value={v.value}
              disabled={!set}
              testId={`fig-variant-${slug(v.name)}`}
              options={v.options.map((value) => ({ value, label: value }))}
              onChange={(value) => set?.(id(), v.name, { variant: value })}
            />
          </PropertyRow>
        )}
      </For>
      <For each={props.instance.properties}>
        {(p) => (
          <PropertyRow
            label={p.name}
            action={
              <Show when={p.changed && props.actions.onReset}>
                {(reset) => (
                  <button
                    type="button"
                    aria-label={`Reset ${p.name}`}
                    title={`Reset ${p.name}`}
                    class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
                    data-testid={`fig-prop-reset-${slug(p.name)}`}
                    onClick={() => reset()(id(), p.id)}
                  >
                    <ArrowCounterClockwise class="size-3" />
                  </button>
                )}
              </Show>
            }
          >
            <PropertyValueControl
              kind={p.kind}
              value={p.value}
              disabled={!set}
              testId={`fig-prop-${slug(p.name)}`}
              components={props.components}
              preferred={p.preferred}
              onChange={(value) => set?.(id(), p.id, value)}
            />
          </PropertyRow>
        )}
      </For>
    </>
  );
}

export function InstanceSection(props: {
  instance: InstanceInfo;
  components: readonly ComponentInfo[];
  actions: InstanceActions;
}) {
  const i = () => props.instance;
  const mainLabel = () =>
    i().set?.name ?? i().main?.name ?? 'Missing component';
  return (
    <Section title="Instance" testId="fig-instance-section">
      <div class="flex min-w-0 items-center gap-1">
        <DiamondsFour class="size-3.5 shrink-0 text-accent" />
        <span
          class="min-w-0 flex-1 truncate font-medium text-ink"
          title={mainLabel()}
          data-testid="fig-main-component"
        >
          {mainLabel()}
        </span>
        <Show when={i().main && i().mainPage !== null}>
          <button
            type="button"
            aria-label="Go to main component"
            title="Go to main component"
            class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
            data-testid="fig-go-to-main"
            onClick={() => props.actions.onGoToMain()}
          >
            <ArrowSquareOut class="size-3.5" />
          </button>
        </Show>
        <Show when={props.actions.onSwap}>
          {(swap) => (
            <ComponentPicker
              label="Swap instance"
              testId="fig-swap-instance"
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
              components={props.components}
              current={i().main?.id}
              onPick={(c) => swap()(i().id, c.id)}
            >
              <Swap class="size-3.5" />
            </ComponentPicker>
          )}
        </Show>
        <Show when={props.actions.onReset}>
          {(reset) => (
            <button
              type="button"
              aria-label="Reset all changes"
              title="Reset all changes"
              class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
              disabled={!i().changed}
              data-testid="fig-reset-instance"
              onClick={() => reset()(i().id)}
            >
              <ArrowCounterClockwise class="size-3.5" />
            </button>
          )}
        </Show>
      </div>
      <Properties
        instance={i()}
        components={props.components}
        actions={props.actions}
      />
      <For each={i().nested}>
        {(n) => (
          <div class="flex flex-col gap-1.5 border-edge-frame border-t pt-1.5">
            <span class="flex items-center gap-1 font-medium text-ink">
              <DiamondsFour class="size-3 text-accent" />
              {n.name}
            </span>
            <Properties
              instance={n}
              components={props.components}
              actions={props.actions}
            />
          </div>
        )}
      </For>
    </Section>
  );
}
