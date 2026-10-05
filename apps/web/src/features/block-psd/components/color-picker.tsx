/**
 * Photoshop's color picker in a panel: the saturation and brightness
 * square, the hue strip, and the color as hex, RGB, and HSB. Dragging
 * reports every color (`done` false) and the last one (`done` true).
 * Presentational.
 */

import type { Rgb } from '@core/psd-engine/types';
import { createSignal, For } from 'solid-js';
import {
  css,
  fromBytes,
  fromHsb,
  type Hsb,
  parseHex,
  toBytes,
  toHex,
  toHsb,
} from '../core/color';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rainbow for the hue strip (the hues themselves, not theme colors). */
const HUES =
  'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';

export function ColorPicker(props: {
  color: Rgb;
  testId?: string;
  onChange: (color: Rgb, done: boolean) => void;
}) {
  // The hue survives gray colors (which have none of their own).
  const [hsb, setHsb] = createSignal<Hsb>(toHsb(props.color));
  const current = (): Hsb => {
    const fromProps = toHsb(props.color);
    const kept = hsb();
    // The prop changed from outside: follow it.
    if (toHex(fromHsb(kept)) !== toHex(props.color)) return fromProps;
    return kept;
  };

  const emit = (next: Hsb, done: boolean) => {
    setHsb(next);
    props.onChange(fromHsb(next), done);
  };

  const drag = (
    e: PointerEvent,
    el: HTMLElement,
    at: (fx: number, fy: number) => Hsb
  ) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent, done: boolean) => {
      const r = el.getBoundingClientRect();
      const fx = clamp01((ev.clientX - r.left) / r.width);
      const fy = clamp01((ev.clientY - r.top) / r.height);
      emit(at(fx, fy), done);
    };
    update(e, false);
    const move = (ev: PointerEvent) => update(ev, false);
    const up = (ev: PointerEvent) => {
      update(ev, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const hueColor = () => css(fromHsb({ h: current().h, s: 1, b: 1 }));

  const field = (
    label: string,
    value: () => number,
    max: number,
    set: (v: number) => Rgb
  ) => (
    <label class="flex items-center gap-1 text-[11px] text-ink-muted">
      <span class="w-3">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        class="w-10 rounded border border-edge-muted bg-input px-1 text-right text-ink tabular-nums outline-none"
        value={Math.round(value())}
        aria-label={label}
        data-testid={
          props.testId ? `${props.testId}-${label.toLowerCase()}` : undefined
        }
        onChange={(e) => {
          const v = Number.parseFloat(e.currentTarget.value);
          if (!Number.isFinite(v)) return;
          const next = set(Math.min(max, Math.max(0, v)));
          setHsb(toHsb(next));
          props.onChange(next, true);
        }}
      />
    </label>
  );

  const bytes = () => toBytes(props.color);

  return (
    <div class="flex flex-col gap-2" data-testid={props.testId}>
      <div
        class="relative h-28 w-full touch-none rounded-md"
        style={{
          'background-color': hueColor(),
          'background-image':
            'linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, transparent)',
        }}
        data-testid={props.testId ? `${props.testId}-area` : undefined}
        onPointerDown={(e) =>
          drag(e, e.currentTarget, (fx, fy) => ({
            h: current().h,
            s: fx,
            b: 1 - fy,
          }))
        }
      >
        <span
          class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow"
          style={{
            left: `${current().s * 100}%`,
            top: `${(1 - current().b) * 100}%`,
            'background-color': css(props.color),
          }}
        />
      </div>
      <div
        class="relative h-3 w-full touch-none rounded-full"
        style={{ 'background-image': HUES }}
        data-testid={props.testId ? `${props.testId}-hue` : undefined}
        onPointerDown={(e) =>
          drag(e, e.currentTarget, (fx) => ({ ...current(), h: fx * 360 }))
        }
      >
        <span
          class="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow"
          style={{
            left: `${(current().h / 360) * 100}%`,
            'background-color': hueColor(),
          }}
        />
      </div>
      <div class="flex items-center gap-2">
        <span
          class="size-6 shrink-0 rounded border border-edge-muted"
          style={{ 'background-color': css(props.color) }}
        />
        <label class="flex items-center gap-1 text-[11px] text-ink-muted">
          #
          <input
            type="text"
            class="w-16 rounded border border-edge-muted bg-input px-1 text-ink uppercase tabular-nums outline-none"
            value={toHex(props.color)}
            aria-label="Hex"
            data-testid={props.testId ? `${props.testId}-hex` : undefined}
            onChange={(e) => {
              const c = parseHex(e.currentTarget.value);
              if (!c) {
                e.currentTarget.value = toHex(props.color);
                return;
              }
              setHsb(toHsb(c));
              props.onChange(c, true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      </div>
      <div class="grid grid-cols-3 gap-1">
        <For each={[0, 1, 2] as const}>
          {(i) =>
            field(
              ['R', 'G', 'B'][i],
              () => bytes()[i],
              255,
              (v) => {
                const b = [...bytes()] as [number, number, number];
                b[i] = v;
                return fromBytes(b[0], b[1], b[2]);
              }
            )
          }
        </For>
        {field(
          'H',
          () => current().h,
          360,
          (v) => fromHsb({ ...current(), h: v })
        )}
        {field(
          'S',
          () => current().s * 100,
          100,
          (v) => fromHsb({ ...current(), s: v / 100 })
        )}
        {field(
          'Br',
          () => current().b * 100,
          100,
          (v) => fromHsb({ ...current(), b: v / 100 })
        )}
      </div>
    </div>
  );
}
