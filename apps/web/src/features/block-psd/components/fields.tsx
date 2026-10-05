/**
 * The panels' small controls: sliders with a number beside them, number
 * fields, menus, and checkboxes. A slider reports every value while it is
 * dragged (`done` false) and the last one when released (`done` true), so
 * one drag can be one undo step. Presentational.
 */

import { createSignal, For, type JSX, Show } from 'solid-js';

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function SliderField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the number (`%`, `px`). */
  unit?: string;
  disabled?: boolean;
  testId?: string;
  onChange: (value: number, done: boolean) => void;
}) {
  const step = () => props.step ?? 1;
  const parse = (text: string) => {
    const v = Number.parseFloat(text);
    return Number.isFinite(v) ? clamp(v, props.min, props.max) : undefined;
  };
  return (
    <label class="flex items-center gap-2 text-ink-muted text-xs">
      <span class="w-20 shrink-0 truncate" title={props.label}>
        {props.label}
      </span>
      <input
        type="range"
        class="h-1 min-w-0 flex-1 accent-accent"
        min={props.min}
        max={props.max}
        step={step()}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        data-testid={props.testId}
        onInput={(e) => props.onChange(Number(e.currentTarget.value), false)}
        onChange={(e) => props.onChange(Number(e.currentTarget.value), true)}
      />
      <span class="flex w-14 shrink-0 items-center rounded border border-edge-muted bg-input px-1">
        <input
          type="text"
          inputMode="decimal"
          class="w-full min-w-0 bg-transparent text-right text-ink tabular-nums outline-none"
          value={formatNumber(props.value, step())}
          disabled={props.disabled}
          aria-label={`${props.label} value`}
          data-testid={props.testId ? `${props.testId}-value` : undefined}
          onChange={(e) => {
            const v = parse(e.currentTarget.value);
            if (v === undefined)
              e.currentTarget.value = formatNumber(props.value, step());
            else props.onChange(v, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <Show when={props.unit}>
          <span class="pl-0.5 text-ink-muted">{props.unit}</span>
        </Show>
      </span>
    </label>
  );
}

/** A number as a field shows it: whole, or to the step's precision. */
export function formatNumber(value: number, step = 1): string {
  if (!Number.isFinite(value)) return '';
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return value
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

export function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  testId?: string;
  /** A compact field (a column of the options bar). */
  narrow?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label class="flex items-center gap-1.5 text-ink-muted text-xs">
      <span class="shrink-0">{props.label}</span>
      <span
        class="flex items-center rounded border border-edge-muted bg-input px-1"
        classList={{ 'w-14': props.narrow, 'w-20': !props.narrow }}
      >
        <input
          type="text"
          inputMode="decimal"
          class="w-full min-w-0 bg-transparent text-right text-ink tabular-nums outline-none"
          value={formatNumber(props.value, props.step ?? 1)}
          disabled={props.disabled}
          aria-label={props.label}
          data-testid={props.testId}
          onChange={(e) => {
            const v = Number.parseFloat(e.currentTarget.value);
            if (!Number.isFinite(v)) {
              e.currentTarget.value = formatNumber(
                props.value,
                props.step ?? 1
              );
              return;
            }
            props.onChange(
              clamp(v, props.min ?? -Infinity, props.max ?? Infinity)
            );
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <Show when={props.unit}>
          <span class="pl-0.5 text-ink-muted">{props.unit}</span>
        </Show>
      </span>
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  testId?: string;
  class?: string;
  onChange: (value: T) => void;
}) {
  return (
    <label class="flex min-w-0 items-center gap-1.5 text-ink-muted text-xs">
      <Show when={props.label}>
        <span class="shrink-0">{props.label}</span>
      </Show>
      <select
        class="h-6 min-w-0 flex-1 rounded border border-edge-muted bg-input px-1 text-ink text-xs outline-none"
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
      >
        <For each={props.options}>
          {(o) => <option value={o.value}>{o.label}</option>}
        </For>
      </select>
    </label>
  );
}

export function CheckField(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  testId?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="flex items-center gap-1.5 text-ink-muted text-xs">
      <input
        type="checkbox"
        class="accent-accent"
        checked={props.checked}
        disabled={props.disabled}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

/** A titled section of a panel. */
export function Section(props: {
  title: string;
  testId?: string;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section
      class="flex flex-col gap-2 border-edge-muted border-b px-3 py-2.5"
      data-testid={props.testId}
    >
      <header class="flex items-center justify-between">
        <h3 class="font-semibold text-ink text-xs">{props.title}</h3>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}

/**
 * Undo keys for slider drags: the same key until a drag ends, so a drag is
 * one undo step and the next drag a new one.
 */
export function createDragKeys(prefix: string) {
  const [count, setCount] = createSignal(0);
  return {
    key: (field: string) => `${prefix}-${field}-${count()}`,
    end: () => setCount((n) => n + 1),
  };
}
