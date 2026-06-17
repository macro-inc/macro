import { Popover } from '@kobalte/core/popover';
import { cn, Layer } from '@ui';
import { batch, createEffect, createSignal, untrack } from 'solid-js';
import { convertOklchTo, getOklch, validateColor } from '../utils/colorUtil';
import type { ThemeReactiveColor } from '../types/themeTypes';
import { ColorSwatch } from './ColorSwatch';

// Chroma axis maxes out at 0.37, matching the Basic editor's chroma slider.
const CHROMA_MAX = 0.37;

/** One gradient-backed track + thumb + transparent range input, mirroring the
 *  slider pattern in ThemeEditorBasic. The track gradient and thumb position are
 *  reactive, so dragging any axis live-updates the preview of the others. */
function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: () => number;
  onValue: (n: number) => void;
  gradient: () => string;
  display: () => string;
}) {
  const pct = () =>
    Math.max(0, Math.min(100, ((props.value() - props.min) / (props.max - props.min)) * 100));
  return (
    <div class="flex items-center gap-2">
      <div class="w-3 shrink-0 font-mono text-xs text-ink-muted">{props.label}</div>
      <div class="relative h-2.5 min-w-0 flex-1">
        <div
          class="absolute left-1/2 top-1/2 h-2.5 w-full -translate-x-1/2 -translate-y-1/2 rounded-sm border border-edge"
          style={{ background: props.gradient() }}
        />
        <div
          class="pointer-events-none absolute top-1/2 h-[18px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-edge bg-accent"
          style={{ left: `${pct()}%` }}
        />
        <input
          class="theme-color-picker-slider absolute -left-[9px] top-1/2 m-0 h-[18px] w-[calc(100%_+_18px)] -translate-y-1/2 cursor-pointer appearance-none bg-transparent outline-none"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value().toString()}
          onInput={(e) => props.onValue(parseFloat(e.currentTarget.value))}
        />
      </div>
      <div class="w-10 shrink-0 text-right font-mono text-xs text-ink-muted">{props.display()}</div>
    </div>
  );
}

/** Clickable swatch that opens a popover with L / C / H sliders and a hex field,
 *  writing directly back into the reactive theme token. */
export function ColorPickerPopover(props: { colorKey: string; colorValue: ThemeReactiveColor }) {
  const l = () => props.colorValue.l[0]();
  const c = () => props.colorValue.c[0]();
  const h = () => props.colorValue.h[0]();
  const oklch = () => `oklch(${l()} ${c()} ${h()}deg)`;

  // Hex field keeps its own text state while typing so slider-driven updates
  // don't fight the user's keystrokes (same guard as ThemeEditorAdvanced).
  const [hexText, setHexText] = createSignal('');
  const [hexInvalid, setHexInvalid] = createSignal(false);
  const [isSetByInput, setIsSetByInput] = createSignal(false);

  createEffect(() => {
    const next = convertOklchTo(l(), c(), h(), 'hex');
    if (untrack(isSetByInput)) { setIsSetByInput(false); }
    else { setHexText(next); }
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
        props.colorValue.l[1](next.l || 0);
        props.colorValue.c[1](next.c || 0);
        props.colorValue.h[1](next.h || 0);
      });
      setHexInvalid(false);
    } catch (error) {
      console.error(`Error processing color "${value}":`, error);
      setHexInvalid(true);
    }
  };

  return (
    <Popover placement="bottom-start" gutter={8}>
      <style>{`
        .theme-color-picker-slider { -webkit-appearance: none; }
        .theme-color-picker-slider::-webkit-slider-thumb { opacity: 0; }
        .theme-color-picker-slider::-moz-range-thumb { opacity: 0; }
      `}</style>

      <Popover.Trigger
        class="block w-full cursor-pointer appearance-none border-none bg-transparent p-0"
        aria-label={`Edit ${props.colorValue.description} (--${props.colorKey})`}
      >
        <ColorSwatch color={oklch()} width="100%" />
      </Popover.Trigger>

      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content class="z-modal">
            <Popover.Arrow class="fill-surface" />
            <div
              class="flex w-64 flex-col gap-3 rounded-md bg-surface p-3 shadow-lg ring-1 ring-edge"
              role="dialog"
              aria-label={`Edit color --${props.colorKey}`}
            >
              <div class="flex items-center gap-2">
                <div
                  class="h-8 w-8 shrink-0 rounded border border-edge"
                  style={{ 'background-color': oklch() }}
                />
                <div class="min-w-0">
                  <div class="truncate text-xs text-ink">{props.colorValue.description}</div>
                  <div class="font-mono text-[0.67rem] text-ink-extra-muted">--{props.colorKey}</div>
                </div>
              </div>

              <Slider
                label="L"
                min={0}
                max={1}
                step={0.01}
                value={l}
                onValue={(n) => props.colorValue.l[1](n)}
                gradient={() => `linear-gradient(to right, oklch(0 ${c()} ${h()}deg), oklch(1 ${c()} ${h()}deg))`}
                display={() => l().toFixed(2)}
              />
              <Slider
                label="C"
                min={0}
                max={CHROMA_MAX}
                step={0.005}
                value={c}
                onValue={(n) => props.colorValue.c[1](n)}
                gradient={() => `linear-gradient(to right, oklch(${l()} 0 ${h()}deg), oklch(${l()} ${CHROMA_MAX} ${h()}deg))`}
                display={() => c().toFixed(3)}
              />
              <Slider
                label="H"
                min={0}
                max={360}
                step={1}
                value={h}
                onValue={(n) => props.colorValue.h[1](n)}
                gradient={() =>
                  `linear-gradient(to right, oklch(${l()} ${c()} 0deg), oklch(${l()} ${c()} 60deg), oklch(${l()} ${c()} 120deg), oklch(${l()} ${c()} 180deg), oklch(${l()} ${c()} 240deg), oklch(${l()} ${c()} 300deg), oklch(${l()} ${c()} 360deg))`
                }
                display={() => `${Math.round(h())}°`}
              />

              <input
                class={cn(
                  'rounded border border-edge-muted bg-transparent px-2 py-1 font-mono text-xs text-ink outline-none',
                  hexInvalid() && 'text-accent'
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
