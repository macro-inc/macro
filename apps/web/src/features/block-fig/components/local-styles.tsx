/**
 * "Local styles" in the design panel when nothing is selected: the file's
 * color, text, effect, and grid styles by folder. Editors rename a style,
 * change a color style's color or a text style's size (every layer using
 * it follows), and delete styles. Presentational: data and actions come in
 * as props.
 */

import type { StyleInfo, StyleType } from '@core/fig-engine/design-types';
import CaretRight from '@phosphor/caret-right.svg';
import Trash from '@phosphor/trash.svg';
import { createSignal, For, Show } from 'solid-js';
import { groupStyles, STYLE_TYPE_LABELS } from '../core/design-system';
import { ColorPicker } from './color-picker';
import { NumberField, TextField } from './design-fields';
import { Section } from './panel-section';
import { StylePreview } from './style-control';
import { SwatchPopover } from './swatch-popover';

export interface LocalStyleActions {
  onRename: (style: string, name: string) => void;
  onColor: (style: string, hex: string, live: boolean) => void;
  onFontSize: (style: string, size: number, live: boolean) => void;
  onDelete: (style: string) => void;
}

const TYPES: Exclude<StyleType, 'OTHER'>[] = ['FILL', 'TEXT', 'EFFECT', 'GRID'];

/** `RRGGBBAA` of a style's first solid paint. */
function solidHex(s: StyleInfo): string | undefined {
  const p = s.paints.find((x) => x.type === 'SOLID' && x.color);
  if (!p?.color) return undefined;
  const a = Math.round((p.alpha ?? 1) * p.opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `${p.color}${a}`.toUpperCase();
}

function StyleRow(props: {
  style: StyleInfo;
  swatches?: readonly string[];
  actions?: LocalStyleActions;
}) {
  const [open, setOpen] = createSignal(false);
  const s = () => props.style;
  return (
    <div data-testid="fig-local-style" data-style-name={s().name}>
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-ink hover:bg-hover"
        title={s().description ?? s().name}
        onClick={() => setOpen((o) => !o)}
      >
        <CaretRight
          class="size-3 shrink-0 text-ink-muted transition-transform"
          classList={{ 'rotate-90': open() }}
        />
        <StylePreview style={s()} />
        <span class="truncate">{s().name.split('/').pop()}</span>
        <Show when={s().text?.fontSize}>
          {(size) => (
            <span class="ml-auto shrink-0 text-ink-muted tabular-nums">
              {size()}
            </span>
          )}
        </Show>
      </button>
      <Show when={open()}>
        <div class="flex flex-col gap-1.5 py-1 pl-6">
          <Show
            when={props.actions}
            fallback={
              <span class="text-ink-muted">{s().description ?? s().name}</span>
            }
          >
            {(actions) => (
              <>
                <TextField
                  value={s().name}
                  class="bg-inset"
                  testId="fig-local-style-name"
                  onChange={(name) => actions().onRename(s().id, name)}
                />
                <Show when={s().type === 'FILL' && solidHex(s())}>
                  {(hex) => (
                    <div class="flex items-center gap-2">
                      <SwatchPopover
                        swatch={`#${hex()}`}
                        label="Style color"
                        testId="fig-local-style-color"
                      >
                        <ColorPicker
                          value={hex()}
                          swatches={props.swatches}
                          onChange={(h, live) =>
                            actions().onColor(s().id, h, live)
                          }
                        />
                      </SwatchPopover>
                      <span class="font-mono text-ink-muted">
                        {hex().slice(0, 6)}
                      </span>
                    </div>
                  )}
                </Show>
                <Show when={s().type === 'TEXT' && s().text}>
                  {(text) => (
                    <>
                      <span class="text-ink-muted">
                        {[text().fontFamily, text().fontStyle]
                          .filter(Boolean)
                          .join(' ')}
                      </span>
                      <NumberField
                        label="Size"
                        value={text().fontSize ?? 12}
                        min={1}
                        testId="fig-local-style-size"
                        onChange={(size, live) =>
                          actions().onFontSize(s().id, size, live)
                        }
                      />
                    </>
                  )}
                </Show>
                <button
                  type="button"
                  class="flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-ink-muted hover:bg-hover hover:text-ink"
                  data-testid="fig-local-style-delete"
                  onClick={() => actions().onDelete(s().id)}
                >
                  <Trash class="size-3" />
                  Delete style
                </button>
              </>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function LocalStyles(props: {
  styles: readonly StyleInfo[];
  swatches?: readonly string[];
  /** Absent when read-only. */
  actions?: LocalStyleActions;
}) {
  const local = () => props.styles.filter((s) => !s.remote);
  return (
    <Show when={local().length > 0}>
      <div data-testid="fig-local-styles">
        <For each={TYPES}>
          {(type) => (
            <Show when={groupStyles(local(), type).length > 0}>
              <Section title={STYLE_TYPE_LABELS[type]}>
                <For each={groupStyles(local(), type)}>
                  {(g) => (
                    <div>
                      <Show when={g.folder}>
                        <div class="px-1 py-0.5 font-semibold text-ink-muted">
                          {g.folder}
                        </div>
                      </Show>
                      <For each={g.styles}>
                        {(s) => (
                          <StyleRow
                            style={s}
                            swatches={props.swatches}
                            actions={props.actions}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Section>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
