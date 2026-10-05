/**
 * Editable effects, as in Figma's design panel: each row picks the kind,
 * toggles visibility, and removes; shadows take offset, blur, spread, and
 * color, blurs a radius. Presentational.
 */

import type { EffectInfo } from '@core/fig-engine/types';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import Minus from '@phosphor/minus.svg';
import { For, Show } from 'solid-js';
import { cssHex, normalizeHex } from '../core/color';
import type { EffectSpec } from '../primitives/create-fig-editor';
import { ColorPicker } from './color-picker';
import { NumberField, TextField } from './design-fields';
import { SwatchPopover } from './swatch-popover';

const KINDS = [
  ['DROP_SHADOW', 'Drop shadow'],
  ['INNER_SHADOW', 'Inner shadow'],
  ['LAYER_BLUR', 'Layer blur'],
  ['BACKGROUND_BLUR', 'Background blur'],
] as const;

/** Specs keeping every effect, with `edit` applied to the one at `index`. */
function specs(
  effects: EffectInfo[],
  index: number,
  edit: EffectSpec | null
): EffectSpec[] {
  return effects.flatMap((_, keep) =>
    keep !== index ? [{ keep }] : edit ? [{ keep, ...edit }] : []
  );
}

function hexWithAlpha(e: EffectInfo): string {
  const a = Math.round(e.alpha * 255);
  return a >= 255
    ? e.color
    : `${e.color}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

export function EffectList(props: {
  effects: EffectInfo[];
  /** Colors the color picker offers (the page's). */
  swatches?: readonly string[];
  /** The color picker opened (to load the page's colors). */
  onPickerOpen?: () => void;
  onChange: (effects: EffectSpec[], live: boolean) => void;
}) {
  const set = (k: number, edit: EffectSpec | null, live = false) =>
    props.onChange(specs(props.effects, k, edit), live);
  return (
    <For each={props.effects}>
      {(e, k) => {
        const shadow = () =>
          e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW';
        return (
          <div
            class="flex flex-col gap-1 rounded-md bg-inset p-1.5"
            classList={{ 'opacity-60': !e.visible }}
            data-testid={`fig-effect-${k()}`}
          >
            <div class="flex items-center gap-1">
              <select
                class="min-w-0 flex-1 rounded bg-transparent px-1 text-ink outline-none"
                aria-label="Effect"
                data-testid={`fig-effect-${k()}-type`}
                onChange={(ev) =>
                  set(k(), {
                    type: ev.currentTarget.value as EffectSpec['type'],
                  })
                }
              >
                <For each={KINDS}>
                  {([value, label]) => (
                    <option value={value} selected={value === e.type}>
                      {label}
                    </option>
                  )}
                </For>
              </select>
              <button
                type="button"
                aria-label={e.visible ? 'Hide' : 'Show'}
                class="rounded p-0.5 text-ink-muted hover:text-ink"
                onClick={() => set(k(), { visible: !e.visible })}
              >
                <Show when={e.visible} fallback={<EyeSlash class="size-3.5" />}>
                  <Eye class="size-3.5" />
                </Show>
              </button>
              <button
                type="button"
                aria-label="Remove effect"
                class="rounded p-0.5 text-ink-muted hover:text-ink"
                onClick={() => set(k(), null)}
              >
                <Minus class="size-3.5" />
              </button>
            </div>
            <Show
              when={shadow()}
              fallback={
                <NumberField
                  label="Blur"
                  value={e.radius}
                  min={0}
                  onChange={(radius, live) => set(k(), { radius }, live)}
                />
              }
            >
              <div class="grid grid-cols-2 gap-1">
                <NumberField
                  label="X"
                  value={e.x}
                  onChange={(x, live) => set(k(), { x }, live)}
                />
                <NumberField
                  label="Y"
                  value={e.y}
                  testId={`fig-effect-${k()}-y`}
                  onChange={(y, live) => set(k(), { y }, live)}
                />
                <NumberField
                  label="Blur"
                  value={e.radius}
                  min={0}
                  testId={`fig-effect-${k()}-blur`}
                  onChange={(radius, live) => set(k(), { radius }, live)}
                />
                <NumberField
                  label="Spread"
                  value={e.spread}
                  onChange={(spread, live) => set(k(), { spread }, live)}
                />
              </div>
              <div class="flex items-center gap-1.5 rounded-md bg-panel px-1.5 py-0.5">
                <SwatchPopover
                  swatch={cssHex(hexWithAlpha(e))}
                  label="Shadow color"
                  testId={`fig-effect-${k()}-swatch`}
                  onOpenChange={(open) => {
                    if (open) props.onPickerOpen?.();
                  }}
                >
                  <ColorPicker
                    value={hexWithAlpha(e)}
                    swatches={props.swatches}
                    onChange={(color, live) => set(k(), { color }, live)}
                  />
                </SwatchPopover>
                <TextField
                  value={hexWithAlpha(e)}
                  class="font-mono"
                  onChange={(v) => {
                    const hex = normalizeHex(v);
                    if (hex) set(k(), { color: hex });
                  }}
                />
              </div>
            </Show>
          </div>
        );
      }}
    </For>
  );
}
