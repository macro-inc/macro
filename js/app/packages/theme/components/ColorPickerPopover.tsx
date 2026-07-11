import { Popover } from '@kobalte/core/popover';
import { Slider } from '@kobalte/core/slider';
import { cn, Layer } from '@ui';
import {
  batch,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { convertOklchTo, getOklch, validateColor } from '../utils/colorUtil';
import { ColorSwatch } from './ColorSwatch';

// Chroma axis maxes out at 0.37, matching the Basic editor's chroma slider.
const CHROMA_MAX = 0.37;

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
  const [dragging, setDragging] = createSignal(false);

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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    });
  });

  return (
    <div
      ref={ref}
      class="relative h-40 flex-1 cursor-crosshair touch-none rounded-md"
      style={{
        background: `linear-gradient(to bottom, transparent, oklch(0 0 ${props.h()}deg)), linear-gradient(to right, oklch(1 0 ${props.h()}deg), oklch(0.65 ${CHROMA_MAX} ${props.h()}deg))`,
      }}
      onPointerDown={(e) => {
        setDragging(true);
        apply(e);
      }}
    >
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
  onL: (n: number) => void;
  onC: (n: number) => void;
  onH: (n: number) => void;
  ariaLabel: string;
  title?: string;
  subtitle?: string;
  /** Width passed to the default trigger swatch (full-width by default). */
  triggerWidth?: string;
  /** Custom trigger content (replaces the default swatch). */
  trigger?: JSX.Element;
}) {
  const oklch = () => `oklch(${props.l()} ${props.c()} ${props.h()}deg)`;

  // Hex field keeps its own text state while dragging so picker-driven updates
  // don't fight the user's keystrokes.
  const [hexText, setHexText] = createSignal('');
  const [hexInvalid, setHexInvalid] = createSignal(false);
  const [isSetByInput, setIsSetByInput] = createSignal(false);

  createEffect(() => {
    const next = convertOklchTo(props.l(), props.c(), props.h(), 'hex');
    if (untrack(isSetByInput)) {
      setIsSetByInput(false);
    } else {
      setHexText(next);
    }
  });

  const setHex = (value: string) => {
    if (!value || value.trim().length < 6 || !validateColor(value)) {
      setHexInvalid(true);
      return;
    }
    try {
      const next = getOklch(value);
      batch(() => {
        setIsSetByInput(true);
        props.onL(next.l || 0);
        props.onC(next.c || 0);
        props.onH(next.h || 0);
      });
      setHexInvalid(false);
    } catch (error) {
      console.error(`Error processing color "${value}":`, error);
      setHexInvalid(true);
    }
  };

  return (
    <Popover placement="bottom-end" gutter={8}>
      <Popover.Trigger
        class="block cursor-pointer appearance-none border-none bg-transparent p-0"
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
              class="flex w-64 flex-col gap-3 rounded-xl bg-surface p-3 shadow-lg ring ring-edge-muted"
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

              <div class="flex gap-3">
                <ColorField
                  l={props.l}
                  c={props.c}
                  h={props.h}
                  onL={props.onL}
                  onC={props.onC}
                />
                <HueSlider h={props.h} onH={props.onH} />
              </div>

              <input
                class={cn(
                  'rounded-md border border-edge-muted bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent',
                  hexInvalid() && 'border-failure text-failure'
                )}
                value={hexText()}
                onInput={(e) => setHex(e.currentTarget.value)}
                spellcheck={false}
                aria-label="Hex color"
              />
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
