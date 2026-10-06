/** Effects stay compact in the inspector; their settings open beside it. */
import type { EffectInfo } from '@core/fig-engine/types';
import { Popover } from '@kobalte/core/popover';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import Minus from '@phosphor/minus.svg';
import Square from '@phosphor/square.svg';
import X from '@phosphor/x.svg';
import { For, Show } from 'solid-js';
import { cssHex, normalizeHex } from '../core/color';
import type { EffectSpec } from '../primitives/create-fig-editor';
import { ColorPicker } from './color-picker';
import { NumberField, TextField } from './design-fields';
import { InspectorSelect } from './inspector-select';
import { SwatchPopover } from './swatch-popover';

const KINDS = [
  ['DROP_SHADOW', 'Drop shadow'],
  ['INNER_SHADOW', 'Inner shadow'],
  ['LAYER_BLUR', 'Layer blur'],
  ['BACKGROUND_BLUR', 'Background blur'],
] as const;

function hexWithAlpha(e: EffectInfo): string {
  const a = Math.round(e.alpha * 255);
  return a >= 255
    ? e.color
    : `${e.color}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}

function EffectSettings(props: {
  effect: EffectInfo;
  index: number;
  swatches?: readonly string[];
  onPickerOpen?: () => void;
  onChange: (edit: EffectSpec, live?: boolean) => void;
}) {
  const e = () => props.effect;
  const shadow = () =>
    e().type === 'DROP_SHADOW' || e().type === 'INNER_SHADOW';
  return (
    <Popover placement="left-start" gutter={16}>
      <Popover.Trigger
        aria-label="Effect settings"
        title="Effect settings"
        data-testid={`fig-effect-${props.index}-settings`}
        class="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-transparent px-1 text-left text-ink hover:bg-hover data-[expanded]:bg-accent-bg data-[expanded]:text-accent"
        classList={{ 'opacity-50': !e().visible }}
      >
        <Square class="size-4 shrink-0" />
        <span class="truncate">
          {KINDS.find(([kind]) => kind === e().type)?.[1] ?? 'Effect'}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="fig-editor-theme z-modal flex w-60 flex-col rounded-xl border border-edge-muted bg-menu text-ink text-xs shadow-xl outline-none"
          aria-label="Effect settings"
          data-testid={`fig-effect-${props.index}-popover`}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
          }}
        >
          <div class="flex items-center justify-between gap-2 border-b border-edge-frame px-2 py-2">
            <Popover.Title class="sr-only">Effect settings</Popover.Title>
            <InspectorSelect
              label="Effect"
              testId={`fig-effect-${props.index}-type`}
              value={e().type}
              options={KINDS.map(([value, label]) => ({ value, label }))}
              onChange={(type) =>
                props.onChange({ type: type as EffectSpec['type'] })
              }
            />
            <Popover.CloseButton
              aria-label="Close effect settings"
              class="flex size-6 items-center justify-center rounded hover:bg-hover"
            >
              <X class="size-3.5" />
            </Popover.CloseButton>
          </div>
          <div class="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 p-4">
            <Show when={shadow()}>
              <span class="self-start pt-1 text-ink-muted">Position</span>
              <NumberField
                label="X"
                value={e().x}
                ariaLabel="Shadow X"
                testId={`fig-effect-${props.index}-x`}
                onChange={(x, live) => props.onChange({ x }, live)}
              />
              <span />
              <NumberField
                label="Y"
                value={e().y}
                ariaLabel="Shadow Y"
                testId={`fig-effect-${props.index}-y`}
                onChange={(y, live) => props.onChange({ y }, live)}
              />
            </Show>
            <span class="text-ink-muted">Blur</span>
            <NumberField
              label=""
              ariaLabel="Blur"
              value={e().radius}
              min={0}
              testId={`fig-effect-${props.index}-blur`}
              onChange={(radius, live) => props.onChange({ radius }, live)}
            />
            <Show when={shadow()}>
              <span class="text-ink-muted">Spread</span>
              <NumberField
                label=""
                ariaLabel="Spread"
                value={e().spread}
                testId={`fig-effect-${props.index}-spread`}
                onChange={(spread, live) => props.onChange({ spread }, live)}
              />
            </Show>
          </div>
          <Show when={shadow()}>
            <span class="px-4 text-ink-muted">Color</span>
            <div class="m-4 mt-2 flex h-6 items-center gap-1.5 rounded-md bg-inset px-2">
              <SwatchPopover
                swatch={cssHex(hexWithAlpha(e()))}
                label="Shadow color"
                testId={`fig-effect-${props.index}-swatch`}
                onOpenChange={(open) => {
                  if (open) props.onPickerOpen?.();
                }}
              >
                <ColorPicker
                  value={hexWithAlpha(e())}
                  swatches={props.swatches}
                  onChange={(color, live) => props.onChange({ color }, live)}
                />
              </SwatchPopover>
              <TextField
                value={e().color}
                onChange={(value) => {
                  const hex = normalizeHex(value);
                  if (hex)
                    props.onChange({
                      color:
                        hex.length === 6
                          ? `${hex}${Math.round(e().alpha * 255)
                              .toString(16)
                              .padStart(2, '0')}`
                          : hex,
                    });
                }}
              />
              <div class="w-14 shrink-0 border-l border-edge-frame">
                <NumberField
                  label=""
                  ariaLabel="Shadow opacity"
                  percent
                  min={0}
                  max={1}
                  value={e().alpha}
                  onChange={(alpha, live) =>
                    props.onChange(
                      {
                        color: `${e().color}${Math.round(alpha * 255)
                          .toString(16)
                          .padStart(2, '0')}`,
                      },
                      live
                    )
                  }
                />
              </div>
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

export function EffectList(props: {
  effects: EffectInfo[];
  swatches?: readonly string[];
  onPickerOpen?: () => void;
  onChange: (effects: EffectSpec[], live: boolean) => void;
}) {
  const set = (index: number, edit: EffectSpec | null, live = false) =>
    props.onChange(
      props.effects.flatMap((_, keep) =>
        keep !== index ? [{ keep }] : edit ? [{ keep, ...edit }] : []
      ),
      live
    );
  return (
    <For each={props.effects.map((_, index) => index).reverse()}>
      {(index) => (
        <div
          class="flex items-center gap-1"
          data-testid={`fig-effect-${index}`}
        >
          <EffectSettings
            effect={props.effects[index]}
            index={index}
            swatches={props.swatches}
            onPickerOpen={props.onPickerOpen}
            onChange={(edit, live) => set(index, edit, live)}
          />
          <button
            type="button"
            aria-label={
              props.effects[index].visible ? 'Hide effect' : 'Show effect'
            }
            title={props.effects[index].visible ? 'Hide effect' : 'Show effect'}
            class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() =>
              set(index, { visible: !props.effects[index].visible })
            }
          >
            <Show
              when={props.effects[index].visible}
              fallback={<EyeSlash class="size-3.5" />}
            >
              <Eye class="size-3.5" />
            </Show>
          </button>
          <button
            type="button"
            aria-label="Remove effect"
            title="Remove effect"
            class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
            onClick={() => set(index, null)}
          >
            <Minus class="size-3.5" />
          </button>
        </div>
      )}
    </For>
  );
}
