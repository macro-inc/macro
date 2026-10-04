/**
 * Building blocks of the ribbon: compact buttons, labelled groups, popover
 * panels, color pickers, and numeric fields. Presentational.
 */

import { Popover } from '@kobalte/core/popover';
import CaretDown from '@phosphor/caret-down.svg';
import Eyedropper from '@phosphor/eyedropper.svg';
import { cn } from '@ui';
import { Button, type ButtonProps } from '@ui/components/Button';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Show,
  splitProps,
} from 'solid-js';
import type { Swatch } from '../../core/palette';

/** An icon button; `active` shows a pressed state. */
export function RibbonButton(props: ButtonProps & { active?: boolean }) {
  const [local, rest] = splitProps(props, ['active', 'class']);
  return (
    <Button
      variant={local.active ? 'accent' : 'ghost'}
      size="icon-sm"
      square
      aria-pressed={local.active === undefined ? undefined : local.active}
      class={cn('size-7 rounded-md p-1', local.class)}
      {...rest}
    />
  );
}

/** A button with an icon and a short caption. */
export function RibbonTextButton(props: ButtonProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Button
      variant="ghost"
      size="sm"
      square
      class={cn('h-7 gap-1 rounded-md px-1.5 text-xs', local.class)}
      {...rest}
    />
  );
}

/** A labelled cluster of controls, divided from the next. */
export function RibbonGroup(props: { label: string; children: JSX.Element }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      class="flex shrink-0 items-center gap-0.5 border-edge-muted border-r pr-1.5 pl-1 last:border-r-0"
    >
      {props.children}
    </div>
  );
}

/**
 * A button that opens a floating panel. The panel is portaled, so it is
 * never clipped by the scrolling ribbon.
 */
export function RibbonPopover(props: {
  label: string;
  icon: JSX.Element;
  text?: string;
  disabled?: boolean;
  testId?: string;
  class?: string;
  placement?: 'bottom-start' | 'bottom-end' | 'bottom';
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement={props.placement ?? 'bottom-start'}
      gutter={4}
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        square
        class="h-7 gap-0.5 rounded-md px-1.5 text-xs"
        label={props.label}
        tooltip={props.label}
        disabled={props.disabled}
        data-testid={props.testId}
      >
        {props.icon}
        <Show when={props.text}>
          <span>{props.text}</span>
        </Show>
        <CaretDown class="size-2.5 opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class={cn(
            'z-action-menu rounded-xl border border-edge bg-menu p-2 text-ink text-xs shadow-xl outline-none',
            props.class
          )}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {props.children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** A row of menu-like actions inside a popover. */
export function PopoverItem(props: {
  label: string;
  icon?: JSX.Element;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.disabled}
      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink text-xs hover:bg-ink/5 disabled:opacity-50"
      classList={{ 'bg-accent-bg text-accent': props.active }}
      onClick={() => props.onClick()}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        {props.icon}
      </span>
      <span class="flex-1">{props.label}</span>
      <Show when={props.hint}>
        <span class="text-ink-muted">{props.hint}</span>
      </Show>
    </button>
  );
}

export function PopoverLabel(props: { children: JSX.Element }) {
  return (
    <div class="px-1 pt-1 pb-1 font-medium text-ink-muted text-xs">
      {props.children}
    </div>
  );
}

/** The browser's screen color picker (Chromium), where there is one. */
interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): (new () => EyeDropperApi) | undefined =>
  (window as unknown as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;

/** `#rrggbb` or `rgb(r, g, b)` as `RRGGBB`. */
function toHex(css: string): string | undefined {
  const hex = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) return hex[1].toUpperCase();
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(css.trim());
  if (!rgb) return undefined;
  return rgb
    .slice(1, 4)
    .map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

const RECENT_KEY = 'pptx-recent-colors';
const isHex = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9A-F]{6}$/.test(v);
function loadRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(RECENT_KEY) ?? '[]'
    );
    return Array.isArray(stored) ? stored.filter(isHex).slice(0, 10) : [];
  } catch {
    return [];
  }
}
/** Custom colors picked lately (More colors, Eyedropper), newest first. */
const [recentColors, setRecentColors] = createSignal<string[]>(loadRecent());
function rememberColor(hex: string) {
  const next = [hex, ...recentColors().filter((c) => c !== hex)].slice(0, 10);
  setRecentColors(next);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable (private windows); the session keeps them.
  }
}

/**
 * PowerPoint's color picker: theme grid, standard colors, recent colors,
 * none, custom, and the Eyedropper.
 */
export function ColorPicker(props: {
  themeGrid: Swatch[][];
  standard: Swatch[];
  onPick: (value: string | null) => void;
  /** Label of the "no color" choice; omitted when there is none. */
  noneLabel?: string;
  testId?: string;
}) {
  let custom!: HTMLInputElement;
  /** A color from More colors or the Eyedropper (`#rrggbb` or `rgb(…)`). */
  const pickCustom = (css: string) => {
    const hex = toHex(css);
    if (!hex) return;
    rememberColor(hex);
    props.onPick(hex);
  };
  const swatch = (s: Swatch) => (
    <button
      type="button"
      title={s.label}
      aria-label={s.label}
      class="size-4 border border-edge-muted hover:outline hover:outline-2 hover:outline-accent"
      style={{ background: s.css }}
      onClick={() => props.onPick(s.value)}
    />
  );
  return (
    <div class="flex w-52 flex-col gap-1.5" data-testid={props.testId}>
      <Show when={props.noneLabel}>
        <PopoverItem
          label={props.noneLabel!}
          icon={
            <span class="block size-3.5 border border-edge bg-[linear-gradient(to_top_right,transparent_45%,red_45%,red_55%,transparent_55%)]" />
          }
          onClick={() => props.onPick(null)}
        />
      </Show>
      <Show when={props.themeGrid.length > 0}>
        <PopoverLabel>Theme colors</PopoverLabel>
        <div class="flex justify-between px-1">
          <For each={props.themeGrid}>
            {(column) => (
              <div class="flex flex-col gap-0.5">
                {swatch(column[0])}
                <div class="mt-1 flex flex-col">
                  <For each={column.slice(1)}>{swatch}</For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <PopoverLabel>Standard colors</PopoverLabel>
      <div class="flex justify-between px-1">
        <For each={props.standard}>{swatch}</For>
      </div>
      <Show when={recentColors().length > 0}>
        <PopoverLabel>Recent colors</PopoverLabel>
        <div class="flex gap-[5px] px-1" data-testid="pptx-recent-colors">
          <For each={recentColors()}>
            {(hex) => swatch({ value: hex, css: `#${hex}`, label: `#${hex}` })}
          </For>
        </div>
      </Show>
      <PopoverItem
        label="More colors…"
        icon={
          <span class="block size-3.5 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
        }
        onClick={() => custom.click()}
      />
      <Show when={eyeDropper()}>
        {(EyeDropper) => (
          <PopoverItem
            label="Eyedropper"
            icon={<Eyedropper class="size-4" />}
            testId="pptx-eyedropper"
            onClick={() => {
              const Ctor = EyeDropper();
              new Ctor()
                .open()
                .then(({ sRGBHex }) => pickCustom(sRGBHex))
                // Escape cancels the pick.
                .catch(() => {});
            }}
          />
        )}
      </Show>
      <input
        ref={custom}
        type="color"
        class="sr-only"
        tabIndex={-1}
        data-testid="pptx-more-colors"
        onChange={(e) => pickCustom(e.currentTarget.value)}
      />
    </div>
  );
}

/**
 * A small number field that commits on Enter or blur. Arrow keys step it.
 */
export function NumberField(props: {
  label: string;
  value: number | undefined;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the number ("pt", "°"). */
  unit?: string;
  width?: string;
  disabled?: boolean;
  testId?: string;
  precision?: number;
}) {
  const format = (value: number | undefined) =>
    value === undefined
      ? ''
      : String(
          Math.round(value * 10 ** (props.precision ?? 1)) /
            10 ** (props.precision ?? 1)
        );
  const shown = () => format(props.value);
  let input!: HTMLInputElement;
  /** Typed text not committed yet. */
  let dirty = false;
  // Mirrors the value into the field unless something typed is pending: an
  // edit landing meanwhile must not wipe it.
  createEffect(() => {
    const value = shown();
    if (!dirty) input.value = value;
  });
  /** Commits typed text (blur, Enter, or arrow steps); shows what was set. */
  const commit = (el: HTMLInputElement) => {
    if (!dirty) return;
    dirty = false;
    const n = Number.parseFloat(el.value);
    if (!Number.isFinite(n)) {
      el.value = shown();
      return;
    }
    const clamped = Math.min(
      props.max ?? Number.POSITIVE_INFINITY,
      Math.max(props.min ?? Number.NEGATIVE_INFINITY, n)
    );
    el.value = format(clamped);
    if (clamped !== props.value) props.onCommit(clamped);
  };
  return (
    <label
      class="flex h-7 items-center gap-1 rounded-md border border-edge-muted bg-input px-1.5 text-xs focus-within:border-accent"
      classList={{ 'opacity-50': props.disabled }}
      title={props.label}
    >
      <span class="sr-only">{props.label}</span>
      <input
        ref={input}
        type="text"
        inputmode="decimal"
        data-testid={props.testId}
        disabled={props.disabled}
        class="min-w-0 bg-transparent text-right text-ink tabular-nums outline-none"
        style={{ width: props.width ?? '2.5rem' }}
        onInput={() => {
          dirty = true;
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(e.currentTarget);
          } else if (e.key === 'Escape') {
            dirty = false;
            e.currentTarget.value = shown();
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1);
            const base = dirty
              ? Number.parseFloat(e.currentTarget.value) || 0
              : (props.value ?? 0);
            e.currentTarget.value = String(
              base + (e.key === 'ArrowUp' ? step : -step)
            );
            dirty = true;
            commit(e.currentTarget);
          }
        }}
        onBlur={(e) => commit(e.currentTarget)}
      />
      <Show when={props.unit}>
        <span class="text-ink-muted">{props.unit}</span>
      </Show>
    </label>
  );
}

/** A colored bar under an icon showing the current color. */
export function ColorBarIcon(props: { icon: JSX.Element; color?: string }) {
  return (
    <span class="flex flex-col items-center">
      {props.icon}
      <span
        class="-mt-0.5 h-[3px] w-3.5 rounded-sm"
        style={{ background: props.color ?? 'currentColor' }}
      />
    </span>
  );
}
