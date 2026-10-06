/**
 * Fills and strokes as Figma's design panel edits them: one row per paint
 * (top paint first) with its swatch, value, opacity, visibility, and
 * remove, dragged to reorder. The swatch opens the paint picker: the kind
 * (solid, linear, radial, angular, or diamond gradient, image), the color
 * picker, and for gradients the stop bar (click to add a stop, drag to
 * move one, Delete to remove it). Presentational.
 */

import type { PaintInfo, StopInfo } from '@core/fig-engine/types';
import DotsSixVertical from '@phosphor/dots-six-vertical.svg';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import Minus from '@phosphor/minus.svg';
import { createSignal, For, Index, Show } from 'solid-js';
import { cssHex, hexToRgba, normalizeHex, rgbaToHex } from '../core/color';
import { cssColor } from '../core/css';
import {
  addStop,
  editPaint,
  isGradient,
  movePaint,
  moveStop,
  PAINT_TYPES,
  type PaintEdit,
  type PaintType,
  recolorStop,
  removeStop,
  type StopSpec,
  stopHex,
} from '../core/paint';
import { ColorPicker } from './color-picker';
import { NumberField, TextField } from './design-fields';
import { InspectorSelect } from './inspector-select';
import { SwatchPopover } from './swatch-popover';

const title = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** CSS for a paint's swatch. */
export function paintSwatch(p: PaintInfo): string {
  if (p.type === 'SOLID' && p.color) return cssColor(p.color, p.alpha ?? 1);
  if (p.stops) {
    const stops = p.stops
      .map((s) => `${cssColor(s.color, s.alpha)} ${s.position * 100}%`)
      .join(', ');
    if (p.type === 'GRADIENT_ANGULAR')
      return `conic-gradient(from 90deg, ${stops})`;
    if (p.type === 'GRADIENT_LINEAR') return `linear-gradient(90deg, ${stops})`;
    return `radial-gradient(closest-side, ${stops})`;
  }
  return 'repeating-conic-gradient(var(--color-ink-muted) 0% 25%, transparent 0% 50%) 50% / 6px 6px';
}

/** How a paint row names a paint that is not a plain color. */
export function paintLabel(p: PaintInfo): string {
  if (p.type === 'SOLID' && p.color) return p.color;
  if (p.type === 'IMAGE') return `Image · ${title(p.scaleMode ?? 'FILL')}`;
  // Figma names gradients by kind alone: "Linear", "Radial"…
  if (isGradient(p.type)) return title(p.type.replace('GRADIENT_', ''));
  return title(p.type);
}

/** A solid paint's color as the picker shows it: alpha is the opacity. */
const solidUsesOpacity = (p: PaintInfo) => (p.alpha ?? 1) >= 0.999;

function solidValue(p: PaintInfo): string {
  const c = hexToRgba(p.color ?? '000000');
  return rgbaToHex({
    ...c,
    a: solidUsesOpacity(p) ? p.opacity : (p.alpha ?? 1),
  });
}

/** The spec fields for a color picked for a solid paint. */
function solidEdit(p: PaintInfo, hex: string): PaintEdit {
  if (!solidUsesOpacity(p)) return { color: hex };
  const c = hexToRgba(hex);
  return {
    color: rgbaToHex({ ...c, a: 1 }),
    opacity: Math.round(c.a * 100) / 100,
  };
}

interface ShownStop {
  hex: string;
  position: number;
}

/** The stop bar: the gradient with its stops as handles. */
function GradientBar(props: {
  stops: StopInfo[];
  active: number;
  onActive: (index: number) => void;
  onStops: (stops: StopSpec[], live: boolean, active: number) => void;
}) {
  let bar!: HTMLDivElement;
  const [drag, setDrag] = createSignal<{
    start: StopInfo[];
    index: number;
    stops: StopSpec[];
  }>();
  const shown = (): ShownStop[] =>
    drag()?.stops.map((s) => ({ hex: s.color, position: s.position })) ??
    props.stops.map((s) => ({ hex: stopHex(s), position: s.position }));
  const at = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };
  const gradient = () =>
    `linear-gradient(90deg, ${shown()
      .map((s) => `${cssHex(s.hex)} ${s.position * 100}%`)
      .join(', ')})`;

  return (
    <div
      ref={bar}
      // Focused with its active stop, which Delete removes.
      tabIndex={0}
      aria-label="Gradient stops"
      class="relative mx-2 h-6 touch-none rounded outline-none"
      data-testid="fig-gradient-bar"
      onKeyDown={(e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        e.preventDefault();
        const left = removeStop(props.stops, props.active);
        if (left) props.onStops(left, false, Math.max(0, props.active - 1));
      }}
      style={{
        background: `${gradient()}, repeating-conic-gradient(var(--color-edge-muted) 0% 25%, transparent 0% 50%) 50% / 8px 8px`,
      }}
      onPointerDown={(e) => {
        if (e.target !== bar) return;
        const added = addStop(props.stops, at(e));
        props.onStops(added.stops, false, added.index);
      }}
    >
      <For each={shown()}>
        {(stop, i) => (
          <button
            type="button"
            aria-label={`Stop at ${Math.round(stop.position * 100)}%`}
            aria-pressed={props.active === i()}
            data-testid="fig-gradient-stop"
            class="-translate-x-1/2 absolute top-1/2 size-4 -translate-y-1/2 rounded-sm border-2 border-[white] shadow-[0_0_0_1px_rgba(0,0,0,0.35)] outline-none aria-pressed:shadow-[0_0_0_2px_var(--color-accent)]"
            style={{
              left: `${stop.position * 100}%`,
              background: cssHex(stop.hex),
            }}
            tabIndex={-1}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              bar.focus();
              props.onActive(i());
              setDrag({
                start: props.stops,
                index: i(),
                stops: props.stops.map((s) => ({
                  color: stopHex(s),
                  position: s.position,
                })),
              });
            }}
            onPointerMove={(e) => {
              const d = drag();
              if (!d) return;
              const moved = moveStop(d.start, d.index, at(e));
              setDrag({ ...d, stops: moved.stops });
              props.onActive(moved.index);
              props.onStops(moved.stops, true, moved.index);
            }}
            onPointerUp={(e) => {
              const d = drag();
              if (!d) return;
              const moved = moveStop(d.start, d.index, at(e));
              setDrag(undefined);
              props.onStops(moved.stops, false, moved.index);
            }}
          />
        )}
      </For>
    </div>
  );
}

/** The paint picker: the paint's kind and its colors. */
function PaintEditor(props: {
  paint: PaintInfo;
  swatches?: readonly string[];
  /** Adds an image file; resolves to its hash. */
  onAddImage?: (file: File) => Promise<string | undefined>;
  onEdit: (edit: PaintEdit, live: boolean) => void;
}) {
  const p = () => props.paint;
  const [active, setActive] = createSignal(0);
  const stops = () => p().stops ?? [];
  const activeStop = () => stops()[Math.min(active(), stops().length - 1)];
  let fileInput!: HTMLInputElement;

  const chooseImage = async (file: File | undefined) => {
    if (!file || !props.onAddImage) return;
    const image = await props.onAddImage(file);
    if (image) props.onEdit({ image }, false);
  };

  return (
    <div class="flex flex-col gap-3" data-testid="fig-paint-popover">
      <InspectorSelect
        label="Paint type"
        testId="fig-paint-type"
        value={p().type}
        options={PAINT_TYPES.map((type) => ({
          ...type,
          disabled: type.value === 'IMAGE' && !props.onAddImage,
        }))}
        onChange={(value) => {
          if (value === 'IMAGE') {
            fileInput.click();
            return;
          }
          setActive(0);
          props.onEdit({ type: value as PaintType }, false);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        class="sr-only"
        tabIndex={-1}
        onChange={(e) => void chooseImage(e.currentTarget.files?.[0])}
      />
      <Show when={isGradient(p().type)}>
        <GradientBar
          stops={stops()}
          active={active()}
          onActive={setActive}
          onStops={(next, live, index) => {
            setActive(index);
            props.onEdit({ stops: next }, live);
          }}
        />
        <Show when={activeStop()}>
          {(stop) => (
            <ColorPicker
              value={stopHex(stop())}
              swatches={props.swatches}
              onChange={(hex, live) =>
                props.onEdit(
                  { stops: recolorStop(stops(), active(), hex) },
                  live
                )
              }
            />
          )}
        </Show>
      </Show>
      <Show when={p().type === 'SOLID'}>
        <ColorPicker
          value={solidValue(p())}
          swatches={props.swatches}
          onChange={(hex, live) => props.onEdit(solidEdit(p(), hex), live)}
        />
      </Show>
      <Show when={p().type === 'IMAGE'}>
        <div class="flex w-60 items-center justify-between gap-2 text-xs">
          <span class="text-ink-muted">{paintLabel(p())}</span>
          <Show when={props.onAddImage}>
            <button
              type="button"
              class="rounded-md bg-inset px-2 py-1 text-ink hover:bg-hover"
              onClick={() => fileInput.click()}
            >
              Choose image…
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** Editable paints (fills or strokes), top paint first as in Figma. */
export function PaintList(props: {
  paints: PaintInfo[];
  kind: 'fill' | 'stroke';
  swatches?: readonly string[];
  /** A paint picker opened (to load the page's colors). */
  onPickerOpen?: () => void;
  onAddImage?: (file: File) => Promise<string | undefined>;
  onChange: (specs: PaintEdit[], live: boolean) => void;
}) {
  const indexed = () =>
    props.paints.map((paint, index) => ({ paint, index })).reverse();
  const change = (
    index: number,
    edit: (spec: PaintEdit, paint: PaintInfo) => PaintEdit | null,
    live = false
  ) => props.onChange(editPaint(props.paints, index, edit), live);
  const [dragged, setDragged] = createSignal<number>();
  const [over, setOver] = createSignal<number>();

  // Rows are kept by position, so an open picker survives edits.
  return (
    <Index each={indexed()}>
      {(row) => {
        const paint = () => row().paint;
        const index = () => row().index;
        const testId = () => `fig-${props.kind}-${index()}`;
        return (
          <div
            class="group relative flex h-6 items-center gap-2"
            data-testid={testId()}
            classList={{ 'opacity-60': !paint().visible }}
            onDragOver={(e) => {
              if (dragged() === undefined) return;
              e.preventDefault();
              setOver(index());
            }}
            onDragLeave={() => {
              if (over() === index()) setOver(undefined);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragged();
              setDragged(undefined);
              setOver(undefined);
              if (from !== undefined && from !== index())
                props.onChange(
                  movePaint(props.paints.length, from, index()),
                  false
                );
            }}
          >
            <Show when={over() === index() && dragged() !== index()}>
              <div
                class="pointer-events-none absolute inset-x-0 border-accent"
                classList={{
                  // Rows list top first: a paint dragged up lands above.
                  'top-0 border-t-2': (dragged() ?? 0) < index(),
                  'bottom-0 border-b-2': (dragged() ?? 0) > index(),
                }}
              />
            </Show>
            <span
              draggable={props.paints.length > 1}
              aria-hidden="true"
              class="absolute -left-3 flex w-3 shrink-0 cursor-grab justify-center text-ink-muted opacity-0 group-hover:opacity-100"
              classList={{ invisible: props.paints.length < 2 }}
              onDragStart={(e) => {
                setDragged(index());
                e.dataTransfer?.setData('text/plain', String(index()));
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragged(undefined);
                setOver(undefined);
              }}
            >
              <DotsSixVertical class="size-3" />
            </span>
            <div class="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-inset pl-1">
              <SwatchPopover
                swatch={paintSwatch(paint())}
                label={`Edit ${props.kind}`}
                testId={`${testId()}-swatch`}
                onOpenChange={(open) => {
                  if (open) props.onPickerOpen?.();
                }}
              >
                <PaintEditor
                  paint={paint()}
                  swatches={props.swatches}
                  onAddImage={props.onAddImage}
                  onEdit={(edit, live) =>
                    change(index(), (spec) => ({ ...spec, ...edit }), live)
                  }
                />
              </SwatchPopover>
              <Show
                when={paint().type === 'SOLID'}
                fallback={
                  <span class="min-w-0 flex-1 truncate text-ink">
                    {paintLabel(paint())}
                  </span>
                }
              >
                <TextField
                  value={paint().color ?? ''}
                  class="font-sans"
                  testId={`${testId()}-hex`}
                  onChange={(v) => {
                    const hex = normalizeHex(v);
                    if (!hex) return;
                    // Six digits keep the paint's own alpha; eight set it.
                    change(index(), (spec, p) => ({
                      ...spec,
                      color:
                        hex.length === 6 && (p.alpha ?? 1) < 1
                          ? rgbaToHex({ ...hexToRgba(hex), a: p.alpha ?? 1 })
                          : hex,
                    }));
                  }}
                />
              </Show>
              <div class="w-14 shrink-0 border-l border-edge-frame">
                <NumberField
                  label=""
                  value={paint().opacity}
                  percent
                  min={0}
                  max={1}
                  testId={`${testId()}-opacity`}
                  onChange={(opacity, live) =>
                    change(index(), (spec) => ({ ...spec, opacity }), live)
                  }
                />
              </div>
            </div>
            <button
              type="button"
              aria-label={paint().visible ? 'Hide' : 'Show'}
              data-testid={`${testId()}-visibility`}
              class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() =>
                change(index(), (spec, p) => ({ ...spec, visible: !p.visible }))
              }
            >
              <Show
                when={paint().visible}
                fallback={<EyeSlash class="size-3.5" />}
              >
                <Eye class="size-3.5" />
              </Show>
            </button>
            <button
              type="button"
              aria-label="Remove"
              data-testid={`${testId()}-remove`}
              class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
              onClick={() => change(index(), () => null)}
            >
              <Minus class="size-3.5" />
            </button>
          </div>
        );
      }}
    </Index>
  );
}
