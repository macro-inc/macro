import { Popover } from '@kobalte/core/popover';
import { Slider } from '@kobalte/core/slider';
import { Tabs } from '@kobalte/core/tabs';
import { cn, Layer } from '@ui';
import Color from 'colorjs.io';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import {
  convertOklchTo,
  formatOklch,
  getOklch,
  sanitizeOklch,
  validateColor,
} from '../utils/colorUtil';
import { ColorSwatch } from './ColorSwatch';

// Chroma axis maxes out at 0.37, matching the Basic editor's chroma slider.
const CHROMA_MAX = 0.37;
const COLOR_FIELD_SAMPLE_WIDTH = 64;
const COLOR_FIELD_SAMPLE_HEIGHT = 40;

const RING =
  'pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[white] shadow-[0_1px_3px_oklch(0_0_0/0.4)]';

/** 2D field: chroma on X (0 → max), lightness on Y (top = light). Drag sets both. */
function ColorField(props: {
  l: () => number;
  c: () => number;
  h: () => number;
  onL: (n: number) => void;
  onC: (n: number) => void;
}) {
  let ref!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let drawFrame: number | undefined;
  const [dragging, setDragging] = createSignal(false);

  // CSS overlay gradients do not preserve an exact OKLCH lightness/chroma
  // coordinate at their intersections. Paint the field from the same OKLCH
  // values used by the thumb so its center matches the sampled area.
  createEffect(() => {
    const hue = props.h();
    if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(() => {
      const context = canvas.getContext('2d');
      if (!context) return;

      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = COLOR_FIELD_SAMPLE_WIDTH;
      sampleCanvas.height = COLOR_FIELD_SAMPLE_HEIGHT;
      const sampleContext = sampleCanvas.getContext('2d');
      if (!sampleContext) return;

      const image = sampleContext.createImageData(
        COLOR_FIELD_SAMPLE_WIDTH,
        COLOR_FIELD_SAMPLE_HEIGHT
      );
      const color = new Color('oklch', [0, 0, hue]);

      for (let y = 0; y < COLOR_FIELD_SAMPLE_HEIGHT; y += 1) {
        const lightness = 1 - y / (COLOR_FIELD_SAMPLE_HEIGHT - 1);
        for (let x = 0; x < COLOR_FIELD_SAMPLE_WIDTH; x += 1) {
          const chroma = (x / (COLOR_FIELD_SAMPLE_WIDTH - 1)) * CHROMA_MAX;
          color.coords = [lightness, chroma, hue];
          const [red = 0, green = 0, blue = 0] = color.to('srgb').coords;
          const offset = (y * COLOR_FIELD_SAMPLE_WIDTH + x) * 4;

          image.data[offset] = Math.round(clamp(red, 0, 1) * 255);
          image.data[offset + 1] = Math.round(clamp(green, 0, 1) * 255);
          image.data[offset + 2] = Math.round(clamp(blue, 0, 1) * 255);
          image.data[offset + 3] = 255;
        }
      }

      sampleContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(sampleCanvas, 0, 0, canvas.width, canvas.height);
    });
  });

  const apply = (e: PointerEvent) => {
    const r = ref.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width) / r.width;
    const y = Math.min(Math.max(e.clientY - r.top, 0), r.height) / r.height;
    batch(() => {
      props.onC(x * CHROMA_MAX);
      props.onL(1 - y);
    });
  };

  onMount(() => {
    const move = (e: PointerEvent) => dragging() && apply(e);
    const up = () => setDragging(false);
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up, { passive: true });
    onCleanup(() => {
      if (drawFrame !== undefined) cancelAnimationFrame(drawFrame);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    });
  });

  return (
    <div
      ref={ref}
      class="relative h-40 flex-1 cursor-crosshair touch-none overflow-hidden rounded-md"
      onPointerDown={(e) => {
        setDragging(true);
        apply(e);
      }}
    >
      <canvas
        ref={canvas}
        width={256}
        height={160}
        class="pointer-events-none absolute inset-0 size-full"
      />
      <div
        class={RING}
        style={{
          left: `${(props.c() / CHROMA_MAX) * 100}%`,
          top: `${(1 - props.l()) * 100}%`,
          'background-color': `oklch(${props.l()} ${props.c()} ${props.h()}deg)`,
        }}
      />
    </div>
  );
}

// Vertical hue gradient, 0° at the top → 360° at the bottom. Pairs with the
// slider's `inverted` flag so the thumb (value 0 at top) tracks the gradient.
const HUE_GRADIENT =
  'linear-gradient(to bottom, oklch(0.7 0.2 0deg), oklch(0.7 0.2 60deg), oklch(0.7 0.2 120deg), oklch(0.7 0.2 180deg), oklch(0.7 0.2 240deg), oklch(0.7 0.2 300deg), oklch(0.7 0.2 360deg))';

const HORIZONTAL_HUE_GRADIENT =
  'linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ChannelSlider(props: {
  label: string;
  value: () => number;
  min: number;
  max: number;
  step: number;
  gradient: () => string;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Slider
      minValue={props.min}
      maxValue={props.max}
      step={props.step}
      value={[props.value()]}
      onChange={(value) => props.onChange(value[0] ?? props.min)}
      aria-label={props.label}
      class="flex items-center gap-3"
    >
      <span class="w-10 text-xs text-ink-muted">{props.label}</span>
      <Slider.Track
        class="relative h-3 flex-1 rounded-full border border-edge-muted"
        style={{ background: props.gradient() }}
      >
        <Slider.Fill class="absolute h-full rounded-full bg-transparent" />
        <Slider.Thumb class="top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-[white] bg-surface shadow-[0_1px_3px_oklch(0_0_0/0.4)] outline-none">
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
      <span class="w-12 text-right font-mono text-[11px] text-ink-muted">
        {Math.round(props.value())}
        {props.suffix}
      </span>
    </Slider>
  );
}

/** Vertical hue slider (0 → 360), backed by Kobalte's generic Slider so pointer
 *  dragging and keyboard control come for free; we only style the rail/thumb.
 *  `inverted` keeps 0° at the top (matching the prior hand-rolled slider). */
function HueSlider(props: { h: () => number; onH: (n: number) => void }) {
  return (
    <Slider
      class="relative flex h-40 w-3 shrink-0 touch-none select-none"
      orientation="vertical"
      inverted
      minValue={0}
      maxValue={360}
      step={1}
      value={[props.h()]}
      onChange={(v) => props.onH(v[0] ?? 0)}
      aria-label="Hue"
    >
      <Slider.Track
        class="relative h-full w-full rounded-full"
        style={{ background: HUE_GRADIENT }}
      >
        {/* Kobalte positions the thumb on the main (vertical) axis via `bottom` +
            its own transform; we only center it horizontally and paint it. */}
        <Slider.Thumb
          class="absolute left-1/2 -ml-[7px] size-3.5 rounded-full border-2 border-[white] shadow-[0_1px_3px_oklch(0_0_0/0.4)] outline-none"
          style={{ 'background-color': `oklch(0.7 0.2 ${props.h()}deg)` }}
        >
          <Slider.Input />
        </Slider.Thumb>
      </Slider.Track>
    </Slider>
  );
}

/**
 * A clickable swatch that opens a color picker (2D chroma/lightness field + hue
 * slider + hex field). Generic over how the color is read/written so it backs
 * both the Variables tokens and the Basic editor's accent.
 */
export function ColorPickerPopover(props: {
  l: () => number;
  c: () => number;
  h: () => number;
  alpha?: () => number;
  onL: (n: number) => void;
  onC: (n: number) => void;
  onH: (n: number) => void;
  onAlpha?: (n: number) => void;
  ariaLabel: string;
  title?: string;
  subtitle?: string;
  /** Width passed to the default trigger swatch (full-width by default). */
  triggerWidth?: string;
  /** Custom trigger content (replaces the default swatch). */
  trigger?: JSX.Element;
}) {
  const pickerColor = createMemo(() =>
    sanitizeOklch({
      l: props.l(),
      c: props.c(),
      h: props.h(),
      alpha: props.alpha?.() ?? 1,
    })
  );
  const lightness = () => pickerColor().l;
  const chroma = () => pickerColor().c;
  const hue = () => pickerColor().h;
  const alpha = () => pickerColor().alpha;
  const oklch = () => formatOklch(pickerColor());

  const color = () => new Color(oklch());
  const rgb = createMemo(() => {
    const [r, g, b] = color()
      .to('srgb')
      .coords.map((channel) => clamp(Number(channel) || 0, 0, 1));
    return { r: r * 255, g: g * 255, b: b * 255 };
  });
  const convertedHsl = createMemo(() => {
    const [h, s, l] = color().to('hsl').coords;
    return {
      h: Number(h),
      s: clamp(Number(s) || 0, 0, 100),
      l: clamp(Number(l) || 0, 0, 100),
    };
  });
  const initialHslHue = convertedHsl().h;
  const [hslHue, setHslHue] = createSignal(
    Number.isFinite(initialHslHue) ? initialHslHue : 0
  );

  // HSL hue is undefined at zero saturation. Keep the last meaningful HSL hue
  // so gray, white, and black can be saturated without jumping to red.
  createEffect(() => {
    const next = convertedHsl();
    if (next.s > 0.001 && Number.isFinite(next.h)) setHslHue(next.h);
  });

  const applyColor = (next: Color) => {
    const converted = next.to('oklch');
    const nextH = Number(converted.coords[2]);
    const safe = sanitizeOklch(
      {
        l: converted.coords[0],
        c: converted.coords[1],
        h: nextH,
        alpha: converted.alpha,
      },
      pickerColor()
    );
    batch(() => {
      props.onL(safe.l);
      props.onC(safe.c);
      if (safe.c > 0.0001 && Number.isFinite(nextH)) props.onH(safe.h);
    });
  };

  const setRgbChannel = (channel: 'r' | 'g' | 'b', value: number) => {
    const next = { ...rgb(), [channel]: value };
    applyColor(
      new Color('srgb', [next.r / 255, next.g / 255, next.b / 255], alpha())
    );
  };

  const setHslChannel = (channel: 'h' | 's' | 'l', value: number) => {
    if (channel === 'h') setHslHue(value);
    const next = {
      h: channel === 'h' ? value : hslHue(),
      s: channel === 's' ? value : convertedHsl().s,
      l: channel === 'l' ? value : convertedHsl().l,
    };
    applyColor(new Color('hsl', [next.h, next.s, next.l], alpha()));
  };

  type ColorFormat = 'hex' | 'rgb' | 'hsl';
  const [format, setFormat] = createSignal<ColorFormat>('hex');
  // The format field keeps its own text state while dragging so picker-driven
  // updates don't fight the user's keystrokes.
  const [colorText, setColorText] = createSignal('');
  const [colorInvalid, setColorInvalid] = createSignal(false);
  const [isSetByInput, setIsSetByInput] = createSignal(false);

  createEffect(() => {
    const next = convertOklchTo(
      props.l(),
      props.c(),
      props.h(),
      format(),
      alpha()
    );
    if (untrack(isSetByInput)) {
      setIsSetByInput(false);
    } else {
      setColorText(next);
    }
  });

  const setColorTextValue = (value: string) => {
    setColorText(value);
    if (!value || value.trim().length < 4 || !validateColor(value)) {
      setColorInvalid(true);
      return;
    }
    try {
      const next = getOklch(value);
      batch(() => {
        setIsSetByInput(true);
        props.onL(next.l || 0);
        props.onC(next.c || 0);
        // White, black, and gray have no defined hue. Preserve the picker's
        // current hue so adding chroma does not jump back to red.
        if (next.c > 0.0001) props.onH(next.h || 0);
        props.onAlpha?.(next.alpha);
      });
      setColorInvalid(false);
    } catch (error) {
      console.error(`Error processing color "${value}":`, error);
      setColorInvalid(true);
    }
  };

  return (
    <Popover placement="bottom-end" gutter={8}>
      <Popover.Trigger
        class="block appearance-none border-none bg-transparent p-0"
        aria-label={props.ariaLabel}
      >
        <Show
          when={props.trigger}
          fallback={
            <ColorSwatch color={oklch()} width={props.triggerWidth ?? '100%'} />
          }
        >
          {props.trigger}
        </Show>
      </Popover.Trigger>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-modal">
            <Popover.Arrow class="fill-surface" />
            <div
              class="flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-xl border border-edge-muted bg-surface p-4 shadow-lg"
              role="dialog"
              aria-label={props.ariaLabel}
            >
              <Show when={props.title}>
                <div class="flex items-center gap-2">
                  <div
                    class="size-8 shrink-0 rounded border border-ink/[0.08]"
                    style={{ 'background-color': oklch() }}
                  />
                  <div class="min-w-0">
                    <div class="truncate text-xs text-ink">{props.title}</div>
                    <Show when={props.subtitle}>
                      <div class="font-mono text-[0.67rem] text-ink-extra-muted">
                        {props.subtitle}
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>

              <div class="flex gap-4">
                <ColorField
                  l={lightness}
                  c={chroma}
                  h={hue}
                  onL={props.onL}
                  onC={props.onC}
                />
                <HueSlider h={hue} onH={props.onH} />
              </div>

              <Slider
                minValue={0}
                maxValue={1}
                step={0.01}
                value={[alpha()]}
                onChange={(value) => props.onAlpha?.(value[0] ?? 1)}
                aria-label="Alpha"
                class="flex items-center gap-3"
              >
                <span class="w-10 text-xs text-ink-muted">Alpha</span>
                <Slider.Track
                  class="relative h-3 flex-1 rounded-full border border-edge-muted theme-alpha-track"
                  style={{
                    background: `linear-gradient(to right, transparent, ${formatOklch({ ...pickerColor(), alpha: 1 })}), repeating-conic-gradient(var(--color-surface-2) 0 25%, var(--color-surface-4) 0 50%) 0 / 8px 8px`,
                  }}
                >
                  <Slider.Fill class="absolute h-full rounded-full bg-transparent" />
                  <Slider.Thumb
                    class="top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-[white] bg-[var(--picker-color)] shadow-[0_1px_3px_oklch(0_0_0/0.4)] outline-none"
                    style={{ '--picker-color': oklch() }}
                  >
                    <Slider.Input />
                  </Slider.Thumb>
                </Slider.Track>
                <span class="w-10 text-right font-mono text-[11px] text-ink-muted">
                  {Math.round(alpha() * 100)}%
                </span>
              </Slider>

              <Tabs
                value={format()}
                onChange={(value) => setFormat(value as ColorFormat)}
              >
                <Tabs.List class="grid grid-cols-3 overflow-hidden rounded-md border border-edge-muted bg-inset p-0.5">
                  <For each={['hex', 'rgb', 'hsl'] as const}>
                    {(value) => (
                      <Tabs.Trigger
                        value={value}
                        class="rounded-sm px-3 py-1.5 text-xs uppercase text-ink-muted outline-none data-selected:bg-surface data-selected:text-ink data-selected:shadow-sm"
                      >
                        {value}
                      </Tabs.Trigger>
                    )}
                  </For>
                </Tabs.List>
              </Tabs>

              <Show when={format() === 'rgb'}>
                <div class="flex flex-col gap-3 rounded-md bg-inset p-3">
                  <ChannelSlider
                    label="Red"
                    value={() => rgb().r}
                    min={0}
                    max={255}
                    step={1}
                    gradient={() =>
                      `linear-gradient(to right, rgb(0 ${rgb().g} ${rgb().b}), rgb(255 ${rgb().g} ${rgb().b}))`
                    }
                    onChange={(value) => setRgbChannel('r', value)}
                  />
                  <ChannelSlider
                    label="Green"
                    value={() => rgb().g}
                    min={0}
                    max={255}
                    step={1}
                    gradient={() =>
                      `linear-gradient(to right, rgb(${rgb().r} 0 ${rgb().b}), rgb(${rgb().r} 255 ${rgb().b}))`
                    }
                    onChange={(value) => setRgbChannel('g', value)}
                  />
                  <ChannelSlider
                    label="Blue"
                    value={() => rgb().b}
                    min={0}
                    max={255}
                    step={1}
                    gradient={() =>
                      `linear-gradient(to right, rgb(${rgb().r} ${rgb().g} 0), rgb(${rgb().r} ${rgb().g} 255))`
                    }
                    onChange={(value) => setRgbChannel('b', value)}
                  />
                </div>
              </Show>

              <Show when={format() === 'hsl'}>
                <div class="flex flex-col gap-3 rounded-md bg-inset p-3">
                  <ChannelSlider
                    label="Hue"
                    value={hslHue}
                    min={0}
                    max={360}
                    step={1}
                    gradient={() => HORIZONTAL_HUE_GRADIENT}
                    suffix="°"
                    onChange={(value) => setHslChannel('h', value)}
                  />
                  <ChannelSlider
                    label="Sat"
                    value={() => convertedHsl().s}
                    min={0}
                    max={100}
                    step={1}
                    gradient={() =>
                      `linear-gradient(to right, hsl(${hslHue()} 0% ${convertedHsl().l}%), hsl(${hslHue()} 100% ${convertedHsl().l}%))`
                    }
                    suffix="%"
                    onChange={(value) => setHslChannel('s', value)}
                  />
                  <ChannelSlider
                    label="Light"
                    value={() => convertedHsl().l}
                    min={0}
                    max={100}
                    step={1}
                    gradient={() =>
                      `linear-gradient(to right, hsl(${hslHue()} ${convertedHsl().s}% 0%), hsl(${hslHue()} ${convertedHsl().s}% 50%), hsl(${hslHue()} ${convertedHsl().s}% 100%))`
                    }
                    suffix="%"
                    onChange={(value) => setHslChannel('l', value)}
                  />
                </div>
              </Show>

              <input
                class={cn(
                  'h-10 rounded-md border border-edge-muted bg-transparent px-3 text-center font-mono text-sm text-ink outline-none focus:border-accent',
                  colorInvalid() && 'border-failure text-failure'
                )}
                value={colorText()}
                onInput={(e) => setColorTextValue(e.currentTarget.value)}
                spellcheck={false}
                aria-label={`${format().toUpperCase()} color`}
              />
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
