import { InspectorSelect } from './inspector-select';
/**
 * Figma's color picker: a saturation and brightness square, hue and
 * opacity sliders, the eyedropper (where the browser has one), the value
 * in a chosen format (Hex, RGB, HSL, HSB) with opacity, and the colors
 * used on the page. Drags report `live` changes and commit on release, so
 * one drag is one undo step. Presentational.
 */

import { Slider } from '@kobalte/core/slider';
import Eyedropper from '@phosphor/eyedropper.svg';
import { createSignal, For, Index, Show } from 'solid-js';
import {
  COLOR_FORMATS,
  type ColorFormat,
  cssHex,
  formatFields,
  type Hsva,
  hexToHsva,
  hsvaToHex,
  normalizeHex,
  parseField,
} from '../core/color';
import { isCommitKey } from '../core/shortcuts';

/** The browser's EyeDropper API (Chromium), where available. */
interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): EyeDropperApi | undefined => {
  const Ctor = (
    globalThis as { EyeDropper?: new () => EyeDropperApi } | undefined
  )?.EyeDropper;
  return Ctor ? new Ctor() : undefined;
};

const CHECKER =
  'repeating-conic-gradient(var(--color-edge-muted) 0% 25%, transparent 0% 50%) 50% / 8px 8px';

const HUE_GRADIENT =
  'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)';

const THUMB =
  'pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[white] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)]';

/** One value field that commits on Enter or blur. */
function ValueField(props: {
  value: string;
  label: string;
  testId?: string;
  class?: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = createSignal<string>();
  const commit = () => {
    const text = draft();
    setDraft(undefined);
    if (text !== undefined && text !== props.value) props.onCommit(text);
  };
  return (
    <input
      aria-label={props.label}
      data-testid={props.testId}
      class={`min-w-0 rounded bg-inset px-1.5 py-1 text-ink tabular-nums outline-none focus:outline focus:outline-1 focus:outline-accent ${props.class ?? ''}`}
      value={draft() ?? props.value}
      onFocus={(e) => {
        setDraft(e.currentTarget.value);
        e.currentTarget.select();
      }}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isCommitKey(e)) e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(undefined);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function ColorPicker(props: {
  /** `RRGGBB` or `RRGGBBAA`. */
  value: string;
  onChange: (hex: string, live: boolean) => void;
  /** Colors to offer as swatches (the page's colors). */
  swatches?: readonly string[];
  /** Hides the opacity slider and field (a canvas color). */
  opaque?: boolean;
}) {
  // While editing, the picker keeps its own HSB value: hue survives grays
  // and black, and the value does not jump back while edits are applied.
  const [local, setLocal] = createSignal<Hsva>();
  const [dragging, setDragging] = createSignal(false);
  const sent = new Set<string>();
  const color = (): Hsva => {
    const l = local();
    const value = normalizeHex(props.value) ?? '000000';
    if (l && (dragging() || sent.has(value))) return l;
    return hexToHsva(value);
  };

  const emit = (next: Hsva, live: boolean) => {
    const c = props.opaque ? { ...next, a: 1 } : next;
    const hex = hsvaToHex(c);
    setLocal(c);
    sent.add(hex);
    props.onChange(hex, live);
  };

  // ---- the saturation and brightness square ----------------------------

  let area!: HTMLDivElement;
  const areaAt = (e: PointerEvent): Hsva => {
    const r = area.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { ...color(), s, v };
  };

  const hueColor = () => hsvaToHex({ h: color().h, s: 1, v: 1, a: 1 });
  const opaqueHex = () => hsvaToHex({ ...color(), a: 1 });

  const pickFromScreen = async () => {
    const dropper = eyeDropper();
    if (!dropper) return;
    try {
      const { sRGBHex } = await dropper.open();
      const hex = normalizeHex(sRGBHex);
      if (hex) emit({ ...hexToHsva(hex), a: color().a }, false);
    } catch {
      // Cancelled (Escape).
    }
  };

  const [format, setFormat] = createSignal<ColorFormat>('hex');
  const fields = () => formatFields(color(), format());

  return (
    <div
      class="flex w-60 flex-col gap-2.5 text-ink text-xs"
      data-testid="fig-color-picker"
    >
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(color().s * 100)}% saturation, ${Math.round(color().v * 100)}% brightness`}
        data-testid="fig-color-area"
        class="relative h-44 w-full touch-none rounded-md outline-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), #${hueColor()}`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          emit(areaAt(e), true);
        }}
        onPointerMove={(e) => {
          if (dragging()) emit(areaAt(e), true);
        }}
        onPointerUp={(e) => {
          if (!dragging()) return;
          emit(areaAt(e), false);
          setDragging(false);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const c = color();
          const moves: Record<string, Partial<Hsva>> = {
            ArrowLeft: { s: Math.max(0, c.s - step) },
            ArrowRight: { s: Math.min(1, c.s + step) },
            ArrowUp: { v: Math.min(1, c.v + step) },
            ArrowDown: { v: Math.max(0, c.v - step) },
          };
          const move = moves[e.key];
          if (!move) return;
          e.preventDefault();
          emit({ ...c, ...move }, false);
        }}
      >
        <div
          class={THUMB}
          style={{
            left: `${color().s * 100}%`,
            top: `${(1 - color().v) * 100}%`,
            background: `#${opaqueHex()}`,
          }}
        />
      </div>
      <div class="flex items-center gap-2">
        <Show when={eyeDropper()}>
          <button
            type="button"
            aria-label="Pick a color from the screen"
            title="Eyedropper"
            data-testid="fig-color-eyedropper"
            class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => void pickFromScreen()}
          >
            <Eyedropper class="size-4" />
          </button>
        </Show>
        <div class="flex flex-1 flex-col gap-2">
          <Slider
            minValue={0}
            maxValue={360}
            step={1}
            value={[color().h]}
            aria-label="Hue"
            class="relative flex h-3 w-full touch-none select-none items-center"
            data-testid="fig-color-hue"
            onChange={([h]) => {
              setDragging(true);
              emit({ ...color(), h: h ?? 0 }, true);
            }}
            onChangeEnd={([h]) => {
              emit({ ...color(), h: h ?? 0 }, false);
              setDragging(false);
            }}
          >
            <Slider.Track
              class="relative h-3 w-full rounded-full"
              style={{ background: HUE_GRADIENT }}
            >
              <Slider.Thumb
                class="top-1/2 block size-3.5 -translate-y-1/2 rounded-full border-2 border-[white] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)] outline-none"
                style={{ background: `#${hueColor()}` }}
              >
                <Slider.Input />
              </Slider.Thumb>
            </Slider.Track>
          </Slider>
          <Show when={!props.opaque}>
            <Slider
              minValue={0}
              maxValue={100}
              step={1}
              value={[Math.round(color().a * 100)]}
              aria-label="Opacity"
              class="relative flex h-3 w-full touch-none select-none items-center"
              data-testid="fig-color-alpha"
              onChange={([a]) => {
                setDragging(true);
                emit({ ...color(), a: (a ?? 100) / 100 }, true);
              }}
              onChangeEnd={([a]) => {
                emit({ ...color(), a: (a ?? 100) / 100 }, false);
                setDragging(false);
              }}
            >
              <Slider.Track
                class="relative h-3 w-full rounded-full"
                style={{
                  background: `linear-gradient(to right, transparent, #${opaqueHex()}), ${CHECKER}`,
                }}
              >
                <Slider.Thumb
                  class="top-1/2 block size-3.5 -translate-y-1/2 rounded-full border-2 border-[white] shadow-[0_0_0_1px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.4)] outline-none"
                  style={{ background: cssHex(hsvaToHex(color())) }}
                >
                  <Slider.Input />
                </Slider.Thumb>
              </Slider.Track>
            </Slider>
          </Show>
        </div>
      </div>
      <div class="flex items-center gap-1">
        <InspectorSelect
          label="Color format"
          testId="fig-color-format"
          class="w-18 shrink-0"
          value={format()}
          options={COLOR_FORMATS}
          onChange={setFormat}
        />
        <div class="flex min-w-0 flex-1 gap-1">
          <Index each={fields()}>
            {(value, i) => (
              <ValueField
                value={value()}
                label={`${format().toUpperCase()} ${i + 1}`}
                testId={`fig-color-field-${i}`}
                class={format() === 'hex' ? 'flex-1 font-mono' : 'w-0 flex-1'}
                onCommit={(text) => {
                  const next = parseField(color(), format(), i, text);
                  if (next) emit(next, false);
                }}
              />
            )}
          </Index>
        </div>
        <Show when={!props.opaque}>
          <ValueField
            value={`${Math.round(color().a * 100)}%`}
            label="Opacity"
            testId="fig-color-alpha-field"
            class="w-12 shrink-0"
            onCommit={(text) => {
              const n = Number.parseFloat(text.replace('%', ''));
              if (Number.isFinite(n))
                emit(
                  { ...color(), a: Math.min(100, Math.max(0, n)) / 100 },
                  false
                );
            }}
          />
        </Show>
      </div>
      <Show when={props.swatches && props.swatches.length > 0}>
        <div class="flex flex-col gap-1.5 border-edge-muted border-t pt-2">
          <span class="text-ink-muted">On this page</span>
          <div class="flex flex-wrap gap-1.5">
            <For each={props.swatches}>
              {(hex) => (
                <button
                  type="button"
                  aria-label={`#${hex}`}
                  title={`#${hex}`}
                  data-testid="fig-color-swatch"
                  class="size-5 rounded-sm border border-edge-muted"
                  style={{ background: `${cssHex(hex)}` }}
                  onClick={() => {
                    const next = hexToHsva(hex);
                    emit(
                      hex.length === 8 ? next : { ...next, a: color().a },
                      false
                    );
                  }}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
