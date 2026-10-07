/**
 * Editable fields of the design panel, in Figma's style: numbers that
 * commit on Enter or blur and scrub when their label is dragged, a name
 * field, parsed values, and choices. Presentational.
 */

import { createSignal, For, type JSX } from 'solid-js';
import { evaluate } from '../core/arith';
import { formatMeasure } from '../core/measure';
import { isCommitKey } from '../core/shortcuts';

/**
 * A number with a label. Typing commits on Enter or blur (Escape reverts);
 * dragging the label scrubs the value, one unit per pixel (⇧: ten).
 */
export function NumberField(props: {
  label: string | JSX.Element;
  ariaLabel?: string;
  value: number;
  /** Shown and typed as a percentage of 1. */
  percent?: boolean;
  min?: number;
  max?: number;
  testId?: string;
  /** Layers in the selection differ: shows "Mixed" until typed into. */
  mixed?: boolean;
  /** Adjacent control, such as the width's Fixed / Hug / Fill selector. */
  suffix?: JSX.Element;
  /** `live` changes come from scrubbing (coalesce them); the release
   * commits the last one. */
  onChange: (value: number, live: boolean) => void;
}) {
  const shown = () =>
    props.mixed
      ? 'Mixed'
      : props.percent
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
    if (typed === '') return;
    let v = evaluate(
      /^[+*/]/.test(typed) && !props.mixed ? `${base}${typed}` : typed
    );
    if (v === null) return;
    if (props.percent) v /= 100;
    props.onChange(clamp(v), false);
  };

  let scrub: { x: number; start: number; last?: number } | undefined;
  const onLabelDown = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub = { x: e.clientX, start: props.value };
  };
  const onLabelMove = (e: PointerEvent) => {
    if (!scrub) return;
    const step = (e.shiftKey ? 10 : 1) * (props.percent ? 0.01 : 1);
    const v = clamp(scrub.start + Math.round(e.clientX - scrub.x) * step);
    if (v === scrub.last) return;
    scrub.last = v;
    props.onChange(v, true);
  };
  const onLabelUp = () => {
    const last = scrub?.last;
    scrub = undefined;
    if (last !== undefined) props.onChange(last, false);
  };

  return (
    <div class="flex min-w-0 items-center rounded-md bg-inset focus-within:outline focus-within:outline-1 focus-within:outline-accent">
      <label
        class={`flex h-6 min-w-0 flex-1 items-center ${props.suffix ? 'gap-1 pl-1 pr-0' : 'gap-2 px-2'}`}
      >
        <span
          class="shrink-0 cursor-ew-resize select-none text-ink-muted"
          onPointerDown={onLabelDown}
          onPointerMove={onLabelMove}
          onPointerUp={onLabelUp}
        >
          {props.label}
        </span>
        <input
          class="min-w-0 flex-1 bg-transparent text-ink tabular-nums outline-none"
          aria-label={props.ariaLabel}
          data-testid={props.testId}
          value={draft() ?? shown()}
          onFocus={(e) => {
            setDraft(props.mixed ? '' : e.currentTarget.value);
            e.currentTarget.select();
          }}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (isCommitKey(e)) e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(undefined);
              e.currentTarget.blur();
            }
            if (
              (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
              !props.mixed
            ) {
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
      {props.suffix}
    </div>
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
      class={`min-w-0 flex-1 bg-transparent text-ink tabular-nums outline-none rounded-md px-1 py-0.5 hover:bg-inset focus:bg-inset ${props.class ?? ''}`}
      data-testid={props.testId}
      value={draft() ?? props.value}
      onFocus={(e) => setDraft(e.currentTarget.value)}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isCommitKey(e)) e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(undefined);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * A value typed as text and parsed on commit (Enter or blur), such as a
 * line height that may be `Auto`, a percentage, or pixels.
 */
export function ParsedField<T>(props: {
  label: string | JSX.Element;
  ariaLabel?: string;
  shown: string;
  parse: (text: string) => T | null;
  testId?: string;
  onChange: (value: T) => void;
}) {
  const [draft, setDraft] = createSignal<string>();
  const commit = () => {
    const text = draft();
    setDraft(undefined);
    if (text === undefined || text === props.shown) return;
    const v = props.parse(text);
    if (v !== null) props.onChange(v);
  };
  return (
    <label class="flex h-6 min-w-0 items-center gap-2 rounded-md bg-inset px-2 focus-within:outline focus-within:outline-1 focus-within:outline-accent">
      <span class="shrink-0 select-none text-ink-muted">{props.label}</span>
      <input
        class="min-w-0 flex-1 bg-transparent text-ink tabular-nums outline-none"
        aria-label={props.ariaLabel}
        data-testid={props.testId}
        value={draft() ?? props.shown}
        onFocus={(e) => {
          setDraft(e.currentTarget.value);
          e.currentTarget.select();
        }}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (isCommitKey(e)) e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(undefined);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** A row of icon buttons choosing one value, like Figma's alignment. */
export function ChoiceRow<T extends string>(props: {
  value: string | null | undefined;
  options: readonly { value: T; label: string; icon: JSX.Element }[];
  testId?: string;
  onChange: (value: T) => void;
}) {
  return (
    <div
      class="flex items-center gap-0.5 rounded-md bg-inset p-0.5"
      data-testid={props.testId}
    >
      <For each={props.options}>
        {(o) => (
          <button
            type="button"
            aria-label={o.label}
            title={o.label}
            aria-pressed={props.value === o.value}
            class="flex flex-1 items-center justify-center rounded p-1 text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => props.onChange(o.value)}
          >
            {o.icon}
          </button>
        )}
      </For>
    </div>
  );
}
