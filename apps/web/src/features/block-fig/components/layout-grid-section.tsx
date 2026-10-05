/**
 * The design panel's Layout grid section for frames, as in Figma: "+"
 * adds a 10 px grid; each grid is a square grid, columns, or rows, with
 * its count, alignment, size, margin or offset, gutter, and color, and can
 * be hidden or removed. Presentational.
 */

import type { LayoutGridInfo } from '@core/fig-engine/handoff-types';
import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import Minus from '@phosphor/minus.svg';
import { createSignal, For, Index, Show } from "solid-js";
import { ColorPicker } from './color-picker';
import { NumberField, ParsedField } from './design-fields';
import { Section } from './panel-section';
import { SwatchPopover } from './swatch-popover';

type GridKind = 'GRID' | 'COLUMNS' | 'ROWS';

const kindOf = (g: LayoutGridInfo): GridKind =>
  g.pattern === 'GRID' ? 'GRID' : g.axis === 'X' ? 'COLUMNS' : 'ROWS';

/** A new grid of `kind`, with Figma's defaults. */
export function newGrid(kind: GridKind = 'GRID'): LayoutGridInfo {
  return kind === 'GRID'
    ? {
        pattern: 'GRID',
        axis: 'X',
        align: 'STRETCH',
        visible: true,
        count: 5,
        offset: 0,
        sectionSize: 10,
        gutter: 20,
        color: 'FF0000',
        alpha: 0.1,
      }
    : {
        pattern: 'STRIPES',
        axis: kind === 'COLUMNS' ? 'X' : 'Y',
        align: 'STRETCH',
        visible: true,
        count: 5,
        offset: 0,
        sectionSize: 10,
        gutter: 20,
        color: 'FF0000',
        alpha: 0.1,
      };
}

const toHex = (g: LayoutGridInfo) =>
  `${g.color}${Math.round(g.alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()}`;

function GridRow(props: {
  index: number;
  grid: LayoutGridInfo;
  swatches?: readonly string[];
  onPickerOpen?: () => void;
  onChange: (grid: LayoutGridInfo, live: boolean) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const g = () => props.grid;
  const k = () => props.index;
  const set = (patch: Partial<LayoutGridInfo>, live = false) =>
    props.onChange({ ...g(), ...patch }, live);
  const columns = () => g().axis === 'X';
  return (
    <div class="flex flex-col gap-1.5" data-testid={`fig-grid-${k()}`}>
      <div class="flex items-center gap-1">
        <SwatchPopover
          swatch={`#${g().color}`}
          label="Grid color"
          testId={`fig-grid-color-${k()}`}
          onOpenChange={(o) => {
            if (o) props.onPickerOpen?.();
          }}
        >
          <ColorPicker
            value={toHex(g())}
            swatches={props.swatches}
            onChange={(hex, live) =>
              set(
                {
                  color: hex.slice(0, 6).toUpperCase(),
                  alpha:
                    hex.length >= 8
                      ? Number.parseInt(hex.slice(6, 8), 16) / 255
                      : 1,
                },
                live
              )
            }
          />
        </SwatchPopover>
        <select
          class="min-w-0 flex-1 rounded-md bg-inset px-1.5 py-1 text-ink outline-none"
          aria-label="Grid type"
          data-testid={`fig-grid-type-${k()}`}
          value={kindOf(g())}
          onChange={(e) => {
            const kind = e.currentTarget.value as GridKind;
            props.onChange(
              { ...newGrid(kind), color: g().color, alpha: g().alpha },
              false
            );
          }}
        >
          <option value="GRID">Grid {g().sectionSize}px</option>
          <option value="COLUMNS">
            Columns ({g().count === 0 ? 'Auto' : g().count})
          </option>
          <option value="ROWS">
            Rows ({g().count === 0 ? 'Auto' : g().count})
          </option>
        </select>
        <button
          type="button"
          aria-label="Grid settings"
          aria-expanded={open()}
          class="rounded px-1 text-ink-muted hover:bg-hover hover:text-ink aria-expanded:bg-hover"
          data-testid={`fig-grid-settings-${k()}`}
          onClick={() => setOpen((o) => !o)}
        >
          ⋯
        </button>
        <button
          type="button"
          aria-label={g().visible ? 'Hide grid' : 'Show grid'}
          class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
          data-testid={`fig-grid-visible-${k()}`}
          onClick={() => set({ visible: !g().visible })}
        >
          <Show when={g().visible} fallback={<EyeSlash class="size-3.5" />}>
            <Eye class="size-3.5" />
          </Show>
        </button>
        <button
          type="button"
          aria-label="Remove grid"
          class="rounded p-0.5 text-ink-muted hover:bg-hover hover:text-ink"
          data-testid={`fig-grid-remove-${k()}`}
          onClick={props.onRemove}
        >
          <Minus class="size-3.5" />
        </button>
      </div>
      <Show when={open()}>
        <Show
          when={g().pattern === 'STRIPES'}
          fallback={
            <NumberField
              label="Size"
              value={g().sectionSize}
              min={1}
              testId={`fig-grid-size-${k()}`}
              onChange={(sectionSize, live) => set({ sectionSize }, live)}
            />
          }
        >
          <div class="grid grid-cols-2 gap-1.5">
            <ParsedField
              label="Count"
              shown={g().count === 0 ? 'Auto' : String(g().count)}
              testId={`fig-grid-count-${k()}`}
              parse={(text) => {
                if (/^\s*auto\s*$/i.test(text)) return 0;
                const n = Math.round(Number(text));
                return Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : null;
              }}
              onChange={(count) => set({ count })}
            />
            <select
              class="min-w-0 rounded-md bg-inset px-1.5 py-1 text-ink outline-none"
              aria-label="Type"
              data-testid={`fig-grid-align-${k()}`}
              value={g().align}
              onChange={(e) =>
                set({ align: e.currentTarget.value as LayoutGridInfo['align'] })
              }
            >
              <option value="STRETCH">Stretch</option>
              <option value="MIN">{columns() ? 'Left' : 'Top'}</option>
              <option value="CENTER">Center</option>
              <option value="MAX">{columns() ? 'Right' : 'Bottom'}</option>
            </select>
            <Show when={g().align !== 'STRETCH'}>
              <NumberField
                label={columns() ? 'Width' : 'Height'}
                value={g().sectionSize}
                min={1}
                testId={`fig-grid-size-${k()}`}
                onChange={(sectionSize, live) => set({ sectionSize }, live)}
              />
            </Show>
            <Show when={g().align !== 'CENTER'}>
              <NumberField
                label={g().align === 'STRETCH' ? 'Margin' : 'Offset'}
                value={g().offset}
                min={0}
                testId={`fig-grid-offset-${k()}`}
                onChange={(offset, live) => set({ offset }, live)}
              />
            </Show>
            <NumberField
              label="Gutter"
              value={g().gutter}
              min={0}
              testId={`fig-grid-gutter-${k()}`}
              onChange={(gutter, live) => set({ gutter }, live)}
            />
          </div>
        </Show>
      </Show>
    </div>
  );
}

export function LayoutGridSection(props: {
  grids: readonly LayoutGridInfo[];
  /** Edits the frame's grids; absent when read-only. */
  onChange?: (grids: LayoutGridInfo[], live: boolean) => void;
  swatches?: readonly string[];
  onPickerOpen?: () => void;
}) {
  const update = (grids: LayoutGridInfo[], live = false) =>
    props.onChange?.(grids, live);
  return (
    <Section
      title="Layout grid"
      testId="fig-layout-grids"
      onAdd={
        props.onChange ? () => update([...props.grids, newGrid()]) : undefined
      }
    >
      <Show
        when={props.onChange}
        fallback={
          <For each={props.grids}>
            {(g) => (
              <span class="text-ink-muted">
                {g.pattern === 'GRID'
                  ? `Grid ${g.sectionSize}px`
                  : `${g.axis === 'X' ? 'Columns' : 'Rows'} (${g.count === 0 ? 'Auto' : g.count})`}
              </span>
            )}
          </For>
        }
      >
        <Index each={props.grids}>
          {(g, k) => (
            <GridRow
              index={k}
              grid={g()}
              swatches={props.swatches}
              onPickerOpen={props.onPickerOpen}
              onChange={(next, live) =>
                update(
                  props.grids.map((old, i) => (i === k ? next : old)),
                  live
                )
              }
              onRemove={() => update(props.grids.filter((_, i) => i !== k))}
            />
          )}
        </Index>
      </Show>
    </Section>
  );
}
