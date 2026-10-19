import { Button, Select } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { BookingValueUnit } from '../core/booking-units';
import { BookingValueInput } from './booking-value-input';

export type BookingPreset = { value: number; label: string };

export function BookingPresets(props: {
  label: string;
  value: number;
  custom: boolean;
  disabled: boolean;
  compact?: boolean;
  presets: BookingPreset[];
  onChange: (value: number) => void;
  onCustom: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`${props.label} presets`}
      class={`flex flex-wrap ${props.compact ? 'gap-1' : 'gap-1.5'}`}
    >
      <For each={props.presets}>
        {(preset) => (
          <Button
            type="button"
            size={props.compact ? 'sm' : 'md'}
            variant="ghost"
            disabled={props.disabled}
            aria-pressed={!props.custom && props.value === preset.value}
            class={`rounded-full border ${props.compact ? 'h-6 px-2 text-[11px]' : 'px-4'} ${
              !props.custom && props.value === preset.value
                ? 'border-accent/40 bg-accent/10 text-accent not-touch:not-disabled:hover:text-accent'
                : 'border-edge-muted text-ink-muted not-touch:not-disabled:hover:text-ink-muted'
            }`}
            onClick={() => props.onChange(preset.value)}
          >
            {preset.label}
          </Button>
        )}
      </For>
      <Button
        type="button"
        size={props.compact ? 'sm' : 'md'}
        variant="ghost"
        disabled={props.disabled}
        aria-pressed={props.custom}
        class={`rounded-full border ${props.compact ? 'h-6 px-2 text-[11px]' : 'px-4'} ${
          props.custom
            ? 'border-accent/40 bg-accent/10 text-accent not-touch:not-disabled:hover:text-accent'
            : 'border-edge-muted text-ink-muted not-touch:not-disabled:hover:text-ink-muted'
        }`}
        onClick={props.onCustom}
      >
        Custom
      </Button>
    </div>
  );
}

export function focusExactValue(input: () => HTMLInputElement | undefined) {
  queueMicrotask(() => {
    const element = input();
    if (
      !element?.isConnected ||
      element.disabled ||
      element.closest('[hidden], [inert]')
    )
      return;
    element.focus();
    element.select();
  });
}

/** Preset pills retain a distinct Custom choice with an exact value underneath. */
export function BookingRulePresets(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  units: readonly BookingValueUnit[];
  disabled: boolean;
  error?: string;
  presets: BookingPreset[];
  onChange: (value: number) => void;
}) {
  const [manual, setManual] = createSignal(false);
  let exactInput: HTMLInputElement | undefined;
  const custom = () =>
    manual() ||
    !!props.error ||
    !props.presets.some((preset) => preset.value === props.value);
  return (
    <div class="flex min-w-0 flex-col items-start gap-3">
      <BookingPresets
        label={props.label}
        value={props.value}
        custom={custom()}
        disabled={props.disabled}
        presets={props.presets}
        onChange={(value) => {
          if (props.disabled) return;
          setManual(false);
          props.onChange(value);
        }}
        onCustom={() => {
          if (props.disabled) return;
          setManual(true);
          focusExactValue(() => exactInput);
        }}
      />
      <Show when={custom()}>
        <BookingValueInput
          inputRef={(element) => {
            exactInput = element;
          }}
          label={props.label}
          value={props.value}
          min={props.min}
          max={props.max}
          units={props.units}
          compact
          controls={false}
          disabled={props.disabled}
          error={props.error}
          onChange={(value) => {
            if (props.disabled) return;
            setManual(true);
            props.onChange(value);
          }}
        />
      </Show>
    </div>
  );
}

/** Common values use one select; custom values reveal an exact input. */
export function BookingRuleSelect(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  units: readonly BookingValueUnit[];
  disabled: boolean;
  error?: string;
  presets: BookingPreset[];
  onChange: (value: number) => void;
  onCustom?: () => void;
}) {
  const [manual, setManual] = createSignal(false);
  let exactInput: HTMLInputElement | undefined;
  let focusCustom = false;
  let open = false;
  const custom = () =>
    manual() ||
    !!props.error ||
    !props.presets.some((preset) => preset.value === props.value);
  const options = createMemo(() => [
    ...props.presets.map((preset) => ({
      value: String(preset.value),
      label: preset.label,
    })),
    { value: 'custom', label: 'Custom' },
  ]);
  return (
    <div class="flex min-w-0 flex-col items-start gap-2">
      <Select<{ value: string; label: string }>
        options={options()}
        optionValue="value"
        optionTextValue="label"
        value={options().find(
          (option) =>
            option.value === (custom() ? 'custom' : String(props.value))
        )}
        disabled={props.disabled}
        modal={false}
        allowDuplicateSelectionEvents
        disallowEmptySelection
        onOpenChange={(value) => {
          open = value;
        }}
        onChange={(option) => {
          if (!option || props.disabled) return;
          if (option.value === 'custom') {
            focusCustom = open;
            setManual(true);
            props.onCustom?.();
            if (!open) focusExactValue(() => exactInput);
          } else {
            focusCustom = false;
            setManual(false);
            props.onChange(Number(option.value));
          }
        }}
      >
        <Select.Trigger
          {...{ role: 'combobox' }}
          aria-label={props.label}
          class="h-9 rounded-lg px-3 text-sm"
        >
          <Select.Value<{ value: string; label: string }>>
            {(state) => state.selectedOption()?.label}
          </Select.Value>
          <Select.Icon />
        </Select.Trigger>
        <Select.Content
          portalScope="local"
          onCloseAutoFocus={(event) => {
            if (!focusCustom) return;
            focusCustom = false;
            event.preventDefault();
            focusExactValue(() => exactInput);
          }}
        >
          <Select.Listbox />
        </Select.Content>
      </Select>
      <Show when={custom()}>
        <BookingValueInput
          inputRef={(element) => {
            exactInput = element;
          }}
          label={props.label}
          value={props.value}
          min={props.min}
          max={props.max}
          units={props.units}
          compact
          disabled={props.disabled}
          error={props.error}
          onChange={props.onChange}
        />
      </Show>
    </div>
  );
}
