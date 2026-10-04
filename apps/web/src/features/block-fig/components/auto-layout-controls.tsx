/**
 * Editing auto layout as Figma's design panel does: direction, gap (a
 * number, or Auto to space children apart), horizontal and vertical
 * padding, and the 3×3 alignment grid; plus how a layer's width and height
 * follow auto layout (Fixed, Hug, Fill). Presentational.
 */

import type { AutoLayout, NodeInfo, Sizing } from '@core/fig-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import { For, Show } from 'solid-js';
import type { Patch } from '../primitives/create-fig-editor';
import { ChoiceRow, NumberField, ParsedField } from './design-fields';

const icon = 'size-3.5';

const DIRECTIONS = [
  {
    value: 'VERTICAL',
    label: 'Vertical layout',
    icon: <ArrowDown class={icon} />,
  },
  {
    value: 'HORIZONTAL',
    label: 'Horizontal layout',
    icon: <ArrowRight class={icon} />,
  },
] as const;

const SPOTS = ['MIN', 'CENTER', 'MAX'] as const;
type Spot = (typeof SPOTS)[number];

const isAuto = (al: AutoLayout) =>
  al.primaryAlign === 'SPACE_BETWEEN' || al.primaryAlign === 'SPACE_EVENLY';

/** Parses a typed gap: `auto`, or a number (arithmetic allowed). */
function parseGap(text: string): number | 'AUTO' | null {
  const t = text.trim().toLowerCase();
  if (t === 'auto') return 'AUTO';
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function AutoLayoutControls(props: {
  layout: AutoLayout;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const al = () => props.layout;
  const horizontal = () => al().mode === 'HORIZONTAL';
  const primary = (): Spot =>
    (SPOTS as readonly string[]).includes(al().primaryAlign ?? '')
      ? (al().primaryAlign as Spot)
      : 'MIN';
  const counter = (): Spot =>
    (SPOTS as readonly string[]).includes(al().counterAlign ?? '')
      ? (al().counterAlign as Spot)
      : 'MIN';
  // The grid is laid out on screen: rows are vertical spots, columns
  // horizontal ones, whichever is the primary axis.
  const select = (row: Spot, column: Spot) => {
    const [p, c] = horizontal() ? [column, row] : [row, column];
    props.onPatch(
      isAuto(al()) ? { counterAlign: c } : { primaryAlign: p, counterAlign: c },
      false
    );
  };
  const active = (row: Spot, column: Spot) => {
    const [p, c] = horizontal() ? [column, row] : [row, column];
    return c === counter() && (isAuto(al()) || p === primary());
  };
  return (
    <div class="flex flex-col gap-1.5" data-testid="fig-auto-layout">
      <div class="grid grid-cols-[2fr_3fr] gap-1.5">
        <ChoiceRow
          value={al().mode}
          options={DIRECTIONS}
          testId="fig-layout-direction"
          onChange={(layoutMode) => props.onPatch({ layoutMode }, false)}
        />
        <ParsedField
          label="Gap"
          shown={isAuto(al()) ? 'Auto' : String(al().spacing)}
          parse={parseGap}
          testId="fig-field-gap"
          onChange={(gap) =>
            props.onPatch(
              gap === 'AUTO'
                ? { primaryAlign: 'SPACE_BETWEEN' }
                : {
                    itemSpacing: gap,
                    ...(isAuto(al()) ? { primaryAlign: 'MIN' as const } : {}),
                  },
              false
            )
          }
        />
      </div>
      <div class="grid grid-cols-[1fr_1fr_auto] items-start gap-1.5">
        <NumberField
          label="↔"
          value={al().paddingLeft}
          min={0}
          testId="fig-field-padding-h"
          onChange={(v, live) =>
            props.onPatch({ paddingLeft: v, paddingRight: v }, live)
          }
        />
        <NumberField
          label="↕"
          value={al().paddingTop}
          min={0}
          testId="fig-field-padding-v"
          onChange={(v, live) =>
            props.onPatch({ paddingTop: v, paddingBottom: v }, live)
          }
        />
        <div
          class="grid grid-cols-3 gap-0.5 rounded-md bg-inset p-1"
          data-testid="fig-layout-align"
        >
          <For each={SPOTS}>
            {(row) => (
              <For each={SPOTS}>
                {(column) => (
                  <button
                    type="button"
                    aria-label={`Align ${row.toLowerCase()} ${column.toLowerCase()}`}
                    aria-pressed={active(row, column)}
                    class="flex size-3.5 items-center justify-center rounded-sm hover:bg-hover"
                    onClick={() => select(row, column)}
                  >
                    <span
                      class="rounded-full"
                      classList={{
                        'size-2 bg-accent': active(row, column),
                        'size-1 bg-ink-muted': !active(row, column),
                      }}
                    />
                  </button>
                )}
              </For>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

const SIZING_LABEL: Record<Sizing, string> = {
  FIXED: 'Fixed',
  HUG: 'Hug',
  FILL: 'Fill',
};

/** Fixed / Hug / Fill for the width and height, where they apply. */
export function SizingControls(props: {
  info: NodeInfo;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const choices = (): Sizing[] => {
    const out: Sizing[] = ['FIXED'];
    if (props.info.autoLayout || props.info.type === 'TEXT') out.push('HUG');
    if (props.info.layoutParent === 'AUTO') out.push('FILL');
    return out;
  };
  return (
    <Show when={props.info.sizing && choices().length > 1}>
      <div class="grid grid-cols-2 gap-1.5">
        <For each={[0, 1] as const}>
          {(axis) => (
            <select
              class="min-w-0 rounded-md bg-inset px-2 py-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
              aria-label={axis === 0 ? 'Width sizing' : 'Height sizing'}
              data-testid={axis === 0 ? 'fig-sizing-w' : 'fig-sizing-h'}
              value={props.info.sizing?.[axis] ?? 'FIXED'}
              onChange={(e) => {
                const v = e.currentTarget.value as Sizing;
                props.onPatch(
                  axis === 0 ? { sizingHorizontal: v } : { sizingVertical: v },
                  false
                );
              }}
            >
              <For each={choices()}>
                {(c) => (
                  <option
                    value={c}
                    selected={c === (props.info.sizing?.[axis] ?? 'FIXED')}
                  >
                    {axis === 0 ? 'W' : 'H'} · {SIZING_LABEL[c]}
                  </option>
                )}
              </For>
            </select>
          )}
        </For>
      </div>
    </Show>
  );
}
