/**
 * Design ▸ Slide Size ▸ Custom Slide Size…: PowerPoint's named sizes, width
 * and height (inches, or centimeters in metric locales), and orientation;
 * and the question PowerPoint asks when content must change shape:
 * Maximize or Ensure Fit.
 */

import type { SlideScale } from '@core/pptx-engine/types';
import CaretDown from '@phosphor/caret-down.svg';
import CaretUp from '@phosphor/caret-up.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { inputClasses } from '@ui/components/Input';
import { createSignal, For, type JSX } from 'solid-js';
import {
  clampSide,
  formatLength,
  type Orientation,
  orientationOf,
  parseLength,
  presetOf,
  presetSize,
  SLIDE_SIZE_PRESETS,
  unitForLocale,
} from '../core/slide-size';

function OrientationIcon(props: { orientation: Orientation }) {
  const portrait = () => props.orientation === 'portrait';
  return (
    <svg viewBox="0 0 24 24" class="size-6 shrink-0" aria-hidden="true">
      <rect
        x={portrait() ? 6 : 2.5}
        y={portrait() ? 2.5 : 6}
        width={portrait() ? 12 : 19}
        height={portrait() ? 19 : 12}
        rx="1"
        class="fill-page stroke-current"
        stroke-width="1.2"
      />
      <text
        x="12"
        y="15.5"
        text-anchor="middle"
        class="fill-current font-semibold text-[9px]"
      >
        A
      </text>
    </svg>
  );
}

function LengthField(props: {
  label: string;
  value: number;
  unit: 'in' | 'cm';
  testId: string;
  ref: (el: HTMLInputElement) => void;
  onCommit: (pt: number) => void;
}) {
  const shown = () => formatLength(props.value, props.unit);
  const commit = (el: HTMLInputElement) => {
    const pt = parseLength(el.value, props.unit);
    if (pt !== undefined) props.onCommit(clampSide(pt));
    el.value = shown();
  };
  /** A tenth of an inch, or a millimeter. */
  const spin = (direction: 1 | -1) =>
    props.onCommit(
      clampSide(
        props.value + direction * (props.unit === 'in' ? 7.2 : 72 / 25.4)
      )
    );
  return (
    <label class="flex flex-col gap-1 text-ink text-sm">
      {props.label}
      <span class="flex h-7 w-36 items-center rounded-lg border border-edge-frame bg-control focus-within:ring-2 focus-within:ring-edge-muted">
        <input
          ref={props.ref}
          type="text"
          inputmode="decimal"
          class="h-full min-w-0 flex-1 bg-transparent px-2 text-ink text-sm tabular-nums outline-none"
          data-testid={props.testId}
          value={shown()}
          onChange={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            spin(e.key === 'ArrowUp' ? 1 : -1);
          }}
        />
        <span class="flex h-full flex-col border-edge-frame border-l">
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Increase ${props.label.replace(':', '')}`}
            class="flex flex-1 items-center px-1 text-ink-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => spin(1)}
          >
            <CaretUp class="size-2.5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Decrease ${props.label.replace(':', '')}`}
            class="flex flex-1 items-center px-1 text-ink-muted hover:bg-ink/5 hover:text-ink"
            onClick={() => spin(-1)}
          >
            <CaretDown class="size-2.5" />
          </button>
        </span>
      </span>
    </label>
  );
}

export function SlideSizeDialog(props: {
  /** The deck's size in points. */
  width: number;
  height: number;
  onOk: (width: number, height: number) => void;
  onClose: () => void;
}) {
  const unit = unitForLocale(
    typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US'
  );
  const [size, setSize] = createSignal({
    width: props.width,
    height: props.height,
  });
  const [preset, setPreset] = createSignal(presetOf(props.width, props.height));
  const orientation = () => orientationOf(size().width, size().height);
  let widthInput!: HTMLInputElement;
  let heightInput!: HTMLInputElement;

  const pickPreset = (id: string) => {
    setPreset(id);
    const next = presetSize(id, orientation());
    if (next) setSize(next);
  };
  const setSide = (side: 'width' | 'height', pt: number) => {
    if (Math.abs(size()[side] - pt) < 0.01) return;
    setSize((s) => ({ ...s, [side]: pt }));
    setPreset('custom');
  };
  const orient = (to: Orientation) => {
    if (to === orientation()) return;
    setSize((s) => ({ width: s.height, height: s.width }));
  };
  const ok = (e: Event) => {
    e.preventDefault();
    // A field still being typed in counts.
    const w = parseLength(widthInput.value, unit);
    const h = parseLength(heightInput.value, unit);
    const width = w !== undefined ? clampSide(w) : size().width;
    const height = h !== undefined ? clampSide(h) : size().height;
    const typed = (a: number, b: number) =>
      formatLength(a, unit) === formatLength(b, unit);
    // Keep exact preset sizes unless a field was changed.
    props.onOk(
      typed(width, size().width) ? size().width : width,
      typed(height, size().height) ? size().height : height
    );
    props.onClose();
  };

  const radio = (to: Orientation, label: string): JSX.Element => (
    <label class="flex items-center gap-2 text-ink text-sm">
      <input
        type="radio"
        name="pptx-slide-size-orientation"
        class="size-3.5 accent-accent"
        checked={orientation() === to}
        data-testid={`pptx-slide-size-${to}`}
        onChange={() => orient(to)}
      />
      <OrientationIcon orientation={to} />
      {label}
    </label>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(480px,94vw)]"
    >
      <form
        class="relative flex flex-col gap-4 p-4"
        data-testid="pptx-slide-size-dialog"
        onSubmit={ok}
      >
        <h2 class="font-semibold text-ink text-sm">Slide Size</h2>
        <div class="flex gap-6">
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <label class="flex flex-col gap-1 text-ink text-sm">
              Slides sized for:
              <select
                class={inputClasses({ size: 'sm', class: 'text-sm' })}
                data-testid="pptx-slide-size-preset"
                value={preset()}
                onChange={(e) => pickPreset(e.currentTarget.value)}
              >
                <For each={SLIDE_SIZE_PRESETS}>
                  {(p) => <option value={p.id}>{p.label}</option>}
                </For>
                <option value="custom">Custom</option>
              </select>
            </label>
            <LengthField
              label="Width:"
              value={size().width}
              unit={unit}
              testId="pptx-slide-size-width"
              ref={(el) => (widthInput = el)}
              onCommit={(pt) => setSide('width', pt)}
            />
            <LengthField
              label="Height:"
              value={size().height}
              unit={unit}
              testId="pptx-slide-size-height"
              ref={(el) => (heightInput = el)}
              onCommit={(pt) => setSide('height', pt)}
            />
          </div>
          <fieldset class="flex shrink-0 flex-col gap-2">
            <legend class="mb-1 font-medium text-ink-muted text-xs">
              Orientation
            </legend>
            <span class="text-ink-muted text-xs">Slides</span>
            {radio('portrait', 'Portrait')}
            {radio('landscape', 'Landscape')}
          </fieldset>
        </div>
        <div class="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            type="submit"
            data-testid="pptx-slide-size-ok"
          >
            OK
          </Button>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          label="Close"
          class="absolute top-3 right-3"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </form>
    </Dialog>
  );
}

/** Content larger than the slide (Maximize) or inside it (Ensure Fit). */
function ScaleIllustration(props: { scale: 'maximize' | 'fit' }) {
  const max = () => props.scale === 'maximize';
  return (
    <svg viewBox="0 0 96 64" class="h-16 w-24" aria-hidden="true">
      <rect
        x="18"
        y="8"
        width="60"
        height="48"
        rx="2"
        class="fill-page stroke-current/60"
        stroke-width="1.5"
      />
      <rect
        x={max() ? 6 : 24}
        y={max() ? 14 : 22}
        width={max() ? 84 : 48}
        height={max() ? 36 : 20}
        rx="2"
        class="fill-accent/35 stroke-accent"
        stroke-width="1.5"
        stroke-dasharray={max() ? '3 2' : undefined}
      />
    </svg>
  );
}

export function ScaleContentDialog(props: {
  onPick: (scale: SlideScale | null) => void;
}) {
  const choice = (scale: 'maximize' | 'fit', label: string) => (
    <button
      type="button"
      class="flex flex-1 flex-col items-center gap-2 rounded-lg border border-edge-muted px-3 py-3 text-ink text-sm hover:border-accent hover:bg-accent-bg"
      data-testid={`pptx-slide-size-${scale}`}
      onClick={() => props.onPick(scale)}
    >
      <ScaleIllustration scale={scale} />
      {label}
    </button>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onPick(null)}
      class="w-[min(420px,94vw)]"
      position="center"
    >
      <div class="flex flex-col gap-4 p-4" data-testid="pptx-slide-size-scale">
        <p class="text-ink text-sm">
          You are scaling to a new slide size. Do you want to maximize the size
          of your content, or scale it down to ensure it will fit on the new
          slide?
        </p>
        <div class="flex gap-3">
          {choice('maximize', 'Maximize')}
          {choice('fit', 'Ensure Fit')}
        </div>
        <div class="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => props.onPick(null)}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
