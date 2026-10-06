/**
 * Controls for component property values: a toggle for boolean
 * properties, a text field for text properties, and a component picker
 * for instance swap properties. Shared by the instance and main component
 * sections.
 */

import type {
  NodeRef,
  PropertyKind,
  ValueInfo,
} from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import CaretDown from '@phosphor/caret-down.svg';
import { type JSX, Match, Switch } from 'solid-js';
import { type PropertyInput, valueLabel } from '../core/design-system';
import { ComponentPicker } from './component-picker';
import { TextField } from './design-fields';

/** A labelled row of the design panel. */
export function PropertyRow(props: {
  label: string;
  children: JSX.Element;
  /** An action at the row's end (a reset, say). */
  action?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <span class="w-20 shrink-0 truncate text-ink-muted" title={props.label}>
        {props.label}
      </span>
      <div class="min-w-0 flex-1">{props.children}</div>
      {props.action}
    </div>
  );
}

export function PropertyValueControl(props: {
  kind: PropertyKind;
  value: ValueInfo;
  testId?: string;
  /** Read-only: the value as text. */
  disabled?: boolean;
  components: readonly ComponentInfo[];
  preferred?: readonly NodeRef[];
  onChange: (value: PropertyInput) => void;
}) {
  return (
    <Switch
      fallback={
        <span class="block truncate text-ink">{valueLabel(props.value)}</span>
      }
    >
      <Match when={props.kind === 'BOOL'}>
        <input
          type="checkbox"
          class="align-middle"
          checked={props.value.bool ?? false}
          disabled={props.disabled}
          data-testid={props.testId}
          onChange={(e) => props.onChange({ bool: e.currentTarget.checked })}
        />
      </Match>
      <Match when={props.kind === 'TEXT' && !props.disabled}>
        <TextField
          value={props.value.text ?? ''}
          class="w-full bg-inset"
          testId={props.testId}
          onChange={(text) => props.onChange({ text })}
        />
      </Match>
      <Match when={props.kind === 'INSTANCE_SWAP' && !props.disabled}>
        <ComponentPicker
          label="Choose an instance"
          testId={props.testId}
          class="flex w-full min-w-0 items-center gap-1 rounded-md bg-inset px-2 py-0.5 text-left text-ink"
          components={props.components}
          preferred={props.preferred}
          current={props.value.component?.id}
          onPick={(c) => props.onChange({ component: c.id })}
        >
          <span class="min-w-0 flex-1 truncate">
            {props.value.component?.name ?? 'None'}
          </span>
          <CaretDown class="size-3 shrink-0 text-ink-muted" />
        </ComponentPicker>
      </Match>
    </Switch>
  );
}
