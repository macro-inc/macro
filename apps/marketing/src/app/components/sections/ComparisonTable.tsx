import {
  type Component,
  type ComponentProps,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

const mobile = () => viewportWidth() < 700;

export type ComparisonCellValue = boolean | 'partial' | string;
export type ComparisonColumn = {
  label: string;
  macro?: boolean;
  /** Supply a source SVG component when a brand asset is available. */
  logo?: Component<ComponentProps<'svg'>>;
  /** Use a rendered icon when the caller needs more control over the mark. */
  icon?: JSX.Element;
};
export type ComparisonRow = {
  feature: JSX.Element;
  cells: readonly ComparisonCellValue[];
};
export type ComparisonTableProps = {
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  mobileCellWidth?: number;
  mobileMinWidth?: number;
  sortRows?: boolean;
  valueWrap?: 'normal' | 'nowrap';
};

function isPriceRow(row: ComparisonRow) {
  return row.cells.some(
    (cell) => typeof cell === 'string' && cell !== 'partial'
  );
}

function orderComparisonRows(rows: readonly ComparisonRow[]) {
  return rows
    .map((row, index) => ({
      index,
      row,
      price: isPriceRow(row),
      support: row.cells.slice(1).reduce(
        (counts, cell) => ({
          checks: counts.checks + (cell === true ? 1 : 0),
          partials: counts.partials + (cell === 'partial' ? 1 : 0),
          crosses: counts.crosses + (cell === false ? 1 : 0),
        }),
        { checks: 0, partials: 0, crosses: 0 }
      ),
    }))
    .sort((a, b) => {
      if (a.price !== b.price) return a.price ? 1 : -1;
      if (b.support.checks !== a.support.checks)
        return b.support.checks - a.support.checks;
      if (b.support.partials !== a.support.partials)
        return b.support.partials - a.support.partials;
      if (a.support.crosses !== b.support.crosses)
        return a.support.crosses - b.support.crosses;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export function CheckMark() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 16 13"
      aria-label="Yes"
      role="img"
      style={{ display: 'block' }}
    >
      <path
        d="M1.5 6.5 L5.8 11 L14.5 1.6"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function PartialMark() {
  return (
    <span
      aria-label="Partial"
      role="img"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 55%, transparent)',
        'border-radius': '999px',
        display: 'block',
        height: '4px',
        width: '14px',
      }}
    />
  );
}

export function CrossMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-label="No"
      role="img"
      style={{ display: 'block', opacity: 0.45 }}
    >
      <path
        d="M2 2 L11 11 M11 2 L2 11"
        fill="none"
        stroke="var(--c4)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

export {
  CheckMark as ComparisonTableCheckMark,
  CrossMark as ComparisonTableCrossMark,
  PartialMark as ComparisonTablePartialMark,
};

function PlaceholderLogo(props: { label: string }) {
  return (
    <span
      aria-hidden="true"
      title={`${props.label} logo placeholder`}
      style={{
        'align-items': 'center',
        border: '1px solid color-mix(in srgb, var(--c4) 34%, transparent)',
        'border-radius': '4px',
        color: 'var(--c4)',
        display: 'inline-flex',
        'font-family': "'cyberreader', body",
        'font-size': mobile() ? '7px' : '8px',
        height: mobile() ? '13px' : '15px',
        'justify-content': 'center',
        'letter-spacing': '0.04em',
        opacity: 0.75,
        width: mobile() ? '13px' : '15px',
      }}
    >
      {props.label.slice(0, 1)}
    </span>
  );
}

function ComparisonCell(props: {
  value: ComparisonCellValue;
  macro: boolean;
  valueWrap: 'normal' | 'nowrap';
}) {
  const textValue = () =>
    typeof props.value === 'string' && props.value !== 'partial';
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
        'text-align': 'center',
      }}
    >
      <Show
        when={textValue()}
        fallback={
          <Show
            when={props.value === true}
            fallback={
              <Show when={props.value === 'partial'} fallback={<CrossMark />}>
                <PartialMark />
              </Show>
            }
          >
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': "'cyberreader', body",
            'font-size': mobile() ? '10px' : '11px',
            'font-weight': '400',
            'letter-spacing': '0.02em',
            'line-height': 1.25,
            'white-space': props.valueWrap,
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

function ComparisonHeader(props: { column: ComparisonColumn; macro: boolean }) {
  return (
    <span
      style={{
        'align-items': 'center',
        display: 'inline-flex',
        'flex-direction': 'column',
        gap: mobile() ? '5px' : '7px',
      }}
    >
      <Show
        when={props.macro}
        fallback={
          <Show
            when={props.column.icon}
            fallback={
              <Show
                when={props.column.logo}
                fallback={<PlaceholderLogo label={props.column.label} />}
              >
                <Dynamic
                  component={props.column.logo!}
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    flex: 'none',
                    height: mobile() ? '13px' : '15px',
                    overflow: 'visible',
                    width: 'auto',
                  }}
                />
              </Show>
            }
          >
            {props.column.icon}
          </Show>
        }
      >
        <MacroMarkIcon
          aria-hidden="true"
          style={{
            color: 'var(--a0)',
            display: 'block',
            fill: 'currentColor',
            flex: 'none',
            height: mobile() ? '13px' : '15px',
            overflow: 'visible',
            stroke: 'none',
          }}
        />
      </Show>
      <span>{props.column.label}</span>
    </span>
  );
}

/* The table's own grid lines. Knocked well down from a solid --b2 so the rows
   read as banding rather than as a ruled grid; the cells behind are alternately
   --b0 and a 4% --c4 tint, and mixing toward transparent lets each row's own
   background come through the line instead of laying one flat grey over both.
   Deliberately NOT applied to the pricing callout's card border below, which is
   an edge around a solid panel rather than a divider between cells. */
const GRID_LINE = 'color-mix(in srgb, var(--b2) 45%, transparent)';

/* The banded rows. Lifted from 4% so the striping actually registers once the
   grid lines above stopped carrying the structure -- with faint lines AND a
   near-invisible band the table lost its rows altogether. Bracketed against 4
   and 10 on screen: 4 barely reads, and by 10 the bands start competing with
   the cell contents rather than just grouping them. */
const ROW_TINT = 'color-mix(in srgb, var(--c4) 7%, var(--b0))';

/** A notched, responsive capability table shared by product and migration pages. */
export function ComparisonTable(props: ComparisonTableProps) {
  const columns = () => props.columns;
  const rows = () =>
    props.sortRows === false ? props.rows : orderComparisonRows(props.rows);
  const isMacro = (column: ComparisonColumn, index: number) =>
    column.macro ?? index === 0;
  const gridTemplate = () =>
    mobile()
      ? `minmax(132px, 1.4fr) repeat(${columns().length}, minmax(${props.mobileCellWidth ?? 58}px, 1fr))`
      : `minmax(0, 2.2fr) repeat(${columns().length}, minmax(0, 1fr))`;

  return (
    <div
      class="comparison-table-scroll"
      style={{
        '-webkit-overflow-scrolling': 'touch',
        'max-width': '100%',
        'min-width': '0',
        'overflow-x': mobile() ? 'auto' : 'visible',
        width: '100%',
      }}
    >
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'font-family': "'cyberreader', body",
          'grid-template-columns': gridTemplate(),
          'min-width': mobile()
            ? `${props.mobileMinWidth ?? Math.max(480, 132 + columns().length * (props.mobileCellWidth ?? 58))}px`
            : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'transparent',
            'border-bottom': `1px solid ${GRID_LINE}`,
          }}
        />
        <For each={columns()}>
          {(column, index) => {
            const macro = () => isMacro(column, index());
            return (
              <div
                style={{
                  'align-items': 'center',
                  'background-color': 'transparent',
                  'border-bottom': `1px solid ${GRID_LINE}`,
                  'border-left': `1px solid ${GRID_LINE}`,
                  'border-right':
                    index() === columns().length - 1
                      ? `1px solid ${GRID_LINE}`
                      : '0',
                  'border-top': `1px solid ${GRID_LINE}`,
                  color: macro() ? 'var(--a0)' : 'var(--c2)',
                  display: 'flex',
                  'font-family': "'cyberreader', body",
                  'font-size': mobile() ? '9px' : '11px',
                  'font-weight': '400',
                  'justify-content': 'center',
                  'letter-spacing': '0.04em',
                  'line-height': 1.1,
                  padding: mobile() ? '10px 6px' : '12px',
                  'text-align': 'center',
                  'text-transform': macro() ? 'uppercase' : 'none',
                }}
              >
                <ComparisonHeader column={column} macro={macro()} />
              </div>
            );
          }}
        </For>
        <For each={rows()}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color':
                    rowIndex() % 2 === 1 ? ROW_TINT : 'var(--b0)',
                  'border-bottom': `1px solid ${GRID_LINE}`,
                  'border-left': `1px solid ${GRID_LINE}`,
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '10px' : '12px',
                  left: mobile() ? '0' : 'auto',
                  'line-height': 1.25,
                  padding: mobile() ? '9px 12px 9px 14px' : '10px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                {row.feature}
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        rowIndex() % 2 === 1 ? ROW_TINT : 'var(--b0)',
                      'border-bottom': `1px solid ${GRID_LINE}`,
                      'border-left': `1px solid ${GRID_LINE}`,
                      'border-right':
                        cellIndex() === row.cells.length - 1
                          ? `1px solid ${GRID_LINE}`
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '9px 6px' : '10px 12px',
                    }}
                  >
                    <ComparisonCell
                      value={cell}
                      macro={isMacro(columns()[cellIndex()]!, cellIndex())}
                      valueWrap={props.valueWrap ?? 'nowrap'}
                    />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

export function ComparisonLegend() {
  return (
    <div
      style={{
        'align-items': 'center',
        color: 'var(--c4)',
        display: 'flex',
        'flex-wrap': 'wrap',
        gap: mobile() ? '16px' : '24px',
        'justify-content': 'center',
      }}
    >
      <span
        style={{
          'align-items': 'center',
          display: 'inline-flex',
          'font-size': '13px',
          gap: '8px',
        }}
      >
        <CheckMark /> Full support
      </span>
      <span
        style={{
          'align-items': 'center',
          display: 'inline-flex',
          'font-size': '13px',
          gap: '8px',
        }}
      >
        <PartialMark /> Partial / limited
      </span>
      <span
        style={{
          'align-items': 'center',
          display: 'inline-flex',
          'font-size': '13px',
          gap: '8px',
        }}
      >
        <CrossMark /> Not available
      </span>
      <Show when={mobile()}>
        <span
          style={{
            'font-family': 'rajdhani, body',
            'font-size': '11px',
            'letter-spacing': '0.06em',
            opacity: 0.6,
            'text-align': 'center',
            'text-transform': 'uppercase',
            width: '100%',
          }}
        >
          Scroll table sideways →
        </span>
      </Show>
    </div>
  );
}
