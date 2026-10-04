/**
 * Editable fields of the design panel, in Figma's style: numbers that
 * commit on Enter or blur and scrub when their label is dragged, a name
 * field, and paint rows (color, opacity, visibility). Presentational.
 */

import type { PaintInfo } from '@core/fig-engine/types';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import Minus from '@phosphor/minus.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { evaluate } from '../core/arith';
import { formatMeasure } from '../core/measure';

const inputClass =
  'min-w-0 flex-1 bg-transparent text-ink tabular-nums outline-none';

/**
 * A number with a label. Typing commits on Enter or blur (Escape reverts);
 * dragging the label scrubs the value, one unit per pixel (⇧: ten).
 */
export function NumberField(props: {
  label: string | JSX.Element;
  value: number;
  /** Shown and typed as a percentage of 1. */
  percent?: boolean;
  min?: number;
  max?: number;
  testId?: string;
  /** `live` changes come from scrubbing (coalesce them). */
  onChange: (value: number, live: boolean) => void;
}) {
  const shown = () =>
    props.percent
      ? `${Math.round(props.value * 100)}%`
      : formatMeasure(props.value);
  const [draft, setDraft] = createSignal<string>();
  const clamp = (v: number) =>
    Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
  const commit = () => {
    const text = draft();
    setDraft(undefined);
    if (text === undefined) return;
    // Arithmetic, as Figma allows ("100*2"); a leading operator applies to
    // the current value ("+10").
    const base = props.percent ? props.value * 100 : props.value;
    const typed = text.replace(/%/g, '').trim();
    let v = evaluate(/^[+*/]/.test(typed) ? `${base}${typed}` : typed);
    if (v === null) return;
    if (props.percent) v /= 100;
    props.onChange(clamp(v), false);
  };

  let scrub: { x: number; start: number } | undefined;
  const onLabelDown = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub = { x: e.clientX, start: props.value };
  };
  const onLabelMove = (e: PointerEvent) => {
    if (!scrub) return;
    const step = (e.shiftKey ? 10 : 1) * (props.percent ? 0.01 : 1);
    const v = scrub.start + Math.round(e.clientX - scrub.x) * step;
    props.onChange(clamp(v), true);
  };
  const onLabelUp = () => {
    scrub = undefined;
  };

  return (
    <label class="flex min-w-0 items-center gap-2 rounded-md bg-inset px-2 py-1 focus-within:outline focus-within:outline-1 focus-within:outline-accent">
      <span
        class="shrink-0 cursor-ew-resize select-none text-ink-muted"
        onPointerDown={onLabelDown}
        onPointerMove={onLabelMove}
        onPointerUp={onLabelUp}
      >
        {props.label}
      </span>
      <input
        class={inputClass}
        data-testid={props.testId}
        value={draft() ?? shown()}
        onFocus={(e) => {
          setDraft(e.currentTarget.value);
          e.currentTarget.select();
        }}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(undefined);
            e.currentTarget.blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (e.shiftKey ? 10 : 1) * (props.percent ? 0.01 : 1);
            props.onChange(
              clamp(props.value + (e.key === 'ArrowUp' ? step : -step)),
              false
            );
            setDraft(undefined);
          }
        }}
      />
    </label>
  );
}

/** A text value that commits on Enter or blur. */
export function TextField(props: {
  value: string;
  class?: string;
  testId?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = createSignal<string>();
  const commit = () => {
    const v = draft();
    setDraft(undefined);
    if (v !== undefined && v !== props.value && v.trim()) props.onChange(v);
  };
  return (
    <input
      class={`${inputClass} rounded-md px-1 py-0.5 hover:bg-inset focus:bg-inset ${props.class ?? ''}`}
      data-testid={props.testId}
      value={draft() ?? props.value}
      onFocus={(e) => setDraft(e.currentTarget.value)}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(undefined);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** `RRGGBB` (and `AA` when translucent) for a paint's color. */
export function paintHex(p: PaintInfo): string | undefined {
  if (!p.color) return undefined;
  const a = p.alpha ?? 1;
  return a < 1
    ? `${p.color}${Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()}`
    : p.color;
}

/** Normalizes typed color: `#abc`, `abc`, `AABBCC`, `AABBCC80`. */
export function normalizeHex(text: string): string | undefined {
  let t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t))
    t = t
      .split('')
      .map((c) => c + c)
      .join('');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) return t.toUpperCase();
  return undefined;
}

/** One editable paint: swatch, hex, opacity, visibility, and remove. */
export function PaintEditRow(props: {
  paint: PaintInfo;
  swatch: string;
  label: string;
  testId?: string;
  onColor: (hex: string) => void;
  onOpacity: (opacity: number, live: boolean) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const p = () => props.paint;
  const solid = () => p().type === 'SOLID';
  let picker!: HTMLInputElement;
  return (
    <div
      class="flex items-center gap-1.5 rounded-md bg-inset px-1.5 py-1"
      data-testid={props.testId}
      classList={{ 'opacity-60': !p().visible }}
    >
      <button
        type="button"
        aria-label="Pick color"
        class="size-4 shrink-0 rounded-sm border border-edge-muted"
        style={{ background: props.swatch }}
        disabled={!solid()}
        onClick={() => picker.click()}
      />
      <input
        ref={picker}
        type="color"
        class="sr-only"
        tabIndex={-1}
        value={`#${(p().color ?? '000000').slice(0, 6)}`}
        onInput={(e) =>
          props.onColor(e.currentTarget.value.slice(1).toUpperCase())
        }
      />
      <Show
        when={solid()}
        fallback={
          <span class="min-w-0 flex-1 truncate text-ink">{props.label}</span>
        }
      >
        <TextField
          value={p().color ?? ''}
          class="font-mono"
          testId={props.testId ? `${props.testId}-hex` : undefined}
          onChange={(v) => {
            const hex = normalizeHex(v);
            if (hex) props.onColor(hex);
          }}
        />
      </Show>
      <div class="w-14 shrink-0">
        <NumberField
          label=""
          value={p().opacity}
          percent
          min={0}
          max={1}
          onChange={props.onOpacity}
        />
      </div>
      <button
        type="button"
        aria-label={p().visible ? 'Hide' : 'Show'}
        class="rounded p-0.5 text-ink-muted hover:text-ink"
        onClick={props.onToggle}
      >
        <Show when={p().visible} fallback={<EyeSlash class="size-3.5" />}>
          <Eye class="size-3.5" />
        </Show>
      </button>
      <button
        type="button"
        aria-label="Remove"
        class="rounded p-0.5 text-ink-muted hover:text-ink"
        onClick={props.onRemove}
      >
        <Minus class="size-3.5" />
      </button>
    </div>
  );
}
