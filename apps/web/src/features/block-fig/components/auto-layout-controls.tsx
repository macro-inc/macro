import { InspectorSelect } from './inspector-select';
/**
 * Editing auto layout as Figma's design panel does: direction, gap (a
 * number, or Auto to space children apart), horizontal and vertical
 * padding, and the 3×3 alignment grid; plus how a layer's width and height
 * follow auto layout (Fixed, Hug, Fill). Presentational.
 */

import type { AutoLayout, NodeInfo, Sizing } from '@core/fig-engine/types';
import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import CornersOut from '@phosphor/corners-out.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { Constraint, Patch } from '../primitives/create-fig-editor';
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
  children?: JSX.Element;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const al = () => props.layout;
  const horizontal = () => al().mode === 'HORIZONTAL';
  const [paddingMode, setPaddingMode] = createSignal<boolean>();
  const individual = () =>
    paddingMode() ??
    (al().paddingLeft !== al().paddingRight ||
      al().paddingTop !== al().paddingBottom);
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
    <div class="flex flex-col gap-2" data-testid="fig-auto-layout">
      <span class="text-ink-muted text-[11px]">Flow</span>
      <ChoiceRow
        value={al().mode}
        options={DIRECTIONS}
        testId="fig-layout-direction"
        onChange={(layoutMode) => props.onPatch({ layoutMode }, false)}
      />
      {props.children}
      <div class="grid grid-cols-2 gap-2">
        <span class="text-ink-muted text-[11px]">Alignment</span>
        <span class="text-ink-muted text-[11px]">Gap</span>
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
                    class="flex h-4 items-center justify-center rounded-sm hover:bg-hover"
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
        <div class="self-start">
          <ParsedField
            label="↔"
            ariaLabel="Gap"
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
      </div>
      <div class="flex items-center justify-between">
        <span class="text-ink-muted text-[11px]">Padding</span>
        <button
          type="button"
          aria-label="Independent padding"
          title="Independent padding"
          aria-pressed={individual()}
          data-testid="fig-padding-independent"
          class="flex size-6 items-center justify-center rounded text-ink-muted hover:bg-hover aria-pressed:bg-accent/15 aria-pressed:text-accent"
          onClick={() => setPaddingMode(!individual())}
        >
          <CornersOut class="size-3.5" />
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <Show
          when={individual()}
          fallback={
            <>
              <NumberField
                label="↔"
                ariaLabel="Horizontal padding"
                value={al().paddingLeft}
                min={0}
                testId="fig-field-padding-h"
                onChange={(v, live) =>
                  props.onPatch({ paddingLeft: v, paddingRight: v }, live)
                }
              />
              <NumberField
                label="↕"
                ariaLabel="Vertical padding"
                value={al().paddingTop}
                min={0}
                testId="fig-field-padding-v"
                onChange={(v, live) =>
                  props.onPatch({ paddingTop: v, paddingBottom: v }, live)
                }
              />
            </>
          }
        >
          <NumberField
            label="←"
            ariaLabel="Left padding"
            value={al().paddingLeft}
            min={0}
            testId="fig-field-padding-left"
            onChange={(paddingLeft, live) =>
              props.onPatch({ paddingLeft }, live)
            }
          />
          <NumberField
            label="↑"
            ariaLabel="Top padding"
            value={al().paddingTop}
            min={0}
            testId="fig-field-padding-top"
            onChange={(paddingTop, live) => props.onPatch({ paddingTop }, live)}
          />
          <NumberField
            label="→"
            ariaLabel="Right padding"
            value={al().paddingRight}
            min={0}
            testId="fig-field-padding-right"
            onChange={(paddingRight, live) =>
              props.onPatch({ paddingRight }, live)
            }
          />
          <NumberField
            label="↓"
            ariaLabel="Bottom padding"
            value={al().paddingBottom}
            min={0}
            testId="fig-field-padding-bottom"
            onChange={(paddingBottom, live) =>
              props.onPatch({ paddingBottom }, live)
            }
          />
        </Show>
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
export function SizingControl(props: {
  info: NodeInfo;
  axis: 0 | 1;
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
      <InspectorSelect
        class="w-10 shrink-0 [&_button]:px-1 [&_svg]:hidden"
        label={props.axis === 0 ? 'Width sizing' : 'Height sizing'}
        testId={props.axis === 0 ? 'fig-sizing-w' : 'fig-sizing-h'}
        value={props.info.sizing?.[props.axis] ?? 'FIXED'}
        options={choices().map((value) => ({
          value,
          label: SIZING_LABEL[value],
        }))}
        onChange={(value) =>
          props.onPatch(
            props.axis === 0
              ? { sizingHorizontal: value as Sizing }
              : { sizingVertical: value as Sizing },
            false
          )
        }
      />
    </Show>
  );
}

const HORIZONTAL_CONSTRAINTS = [
  ['MIN', 'Left'],
  ['MAX', 'Right'],
  ['STRETCH', 'Left & right'],
  ['CENTER', 'Center'],
  ['SCALE', 'Scale'],
] as const;

const VERTICAL_CONSTRAINTS = [
  ['MIN', 'Top'],
  ['MAX', 'Bottom'],
  ['STRETCH', 'Top & bottom'],
  ['CENTER', 'Center'],
  ['SCALE', 'Scale'],
] as const;

/** How the layer follows its frame when the frame is resized. */
export function ConstraintControls(props: {
  constraints: [string, string] | null;
  onPatch: (patch: Patch) => void;
}) {
  const current = (axis: 0 | 1) => props.constraints?.[axis] ?? 'MIN';
  return (
    <div class="flex flex-col gap-1" data-testid="fig-constraints">
      <span class="text-ink-muted">Constraints</span>
      <div class="grid grid-cols-2 gap-1.5">
        <For each={[0, 1] as const}>
          {(axis) => (
            <InspectorSelect
              label={
                axis === 0 ? 'Horizontal constraint' : 'Vertical constraint'
              }
              testId={axis === 0 ? 'fig-constraint-h' : 'fig-constraint-v'}
              value={current(axis)}
              options={(axis === 0
                ? HORIZONTAL_CONSTRAINTS
                : VERTICAL_CONSTRAINTS
              ).map(([value, label]) => ({ value, label }))}
              onChange={(value) =>
                props.onPatch(
                  axis === 0
                    ? { constraintHorizontal: value as Constraint }
                    : { constraintVertical: value as Constraint }
                )
              }
            />
          )}
        </For>
      </div>
    </div>
  );
}
