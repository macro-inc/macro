/**
 * Contextual tabs for tables: Table Design (styles, shading, borders) and
 * Layout (rows, columns, merging, sizes, alignment).
 */

import type { ShapeOutline, TableStyleInfo } from '@core/pptx-engine/types';
import AlignBottom from '@phosphor/align-bottom.svg';
import AlignCenterVertical from '@phosphor/align-center-vertical.svg';
import AlignTop from '@phosphor/align-top.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import Trash from '@phosphor/trash.svg';
import { For, Show } from 'solid-js';
import {
  ColorPicker,
  NumberField,
  PopoverItem,
  PopoverLabel,
  RibbonButton,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { useRibbon } from './ribbon';

const BORDER_EDGES: [string, string][] = [
  ['all', 'All borders'],
  ['outside', 'Outside borders'],
  ['inside', 'Inside borders'],
  ['top', 'Top border'],
  ['bottom', 'Bottom border'],
  ['left', 'Left border'],
  ['right', 'Right border'],
  ['insideHorizontal', 'Inside horizontal'],
  ['insideVertical', 'Inside vertical'],
];

/** A small picture of which edges a border choice draws. */
function BorderIcon(props: { edges: string }) {
  const e = () => props.edges;
  const on = (edge: string) =>
    e() === 'all' ||
    e() === edge ||
    (e() === 'outside' && ['top', 'bottom', 'left', 'right'].includes(edge)) ||
    (e() === 'inside' && ['insideHorizontal', 'insideVertical'].includes(edge));
  const line = (edge: string, d: string) => (
    <path
      d={d}
      class={on(edge) ? 'stroke-ink' : 'stroke-ink/25'}
      stroke-width={on(edge) ? 1.6 : 0.8}
      stroke-dasharray={on(edge) ? undefined : '1 1'}
    />
  );
  return (
    <svg viewBox="0 0 16 16" class="size-4 fill-none">
      {line('top', 'M2 2H14')}
      {line('bottom', 'M2 14H14')}
      {line('left', 'M2 2V14')}
      {line('right', 'M14 2V14')}
      {line('insideHorizontal', 'M2 8H14')}
      {line('insideVertical', 'M8 2V14')}
    </svg>
  );
}

export interface TableTabProps {
  table: ShapeOutline;
  styles: TableStyleInfo[];
  selectRows: () => void;
  selectColumns: () => void;
  selectTable: () => void;
}

export function TableDesignTab(props: TableTabProps) {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  const style = () => props.table.table?.style;
  const option = (
    key:
      | 'firstRow'
      | 'lastRow'
      | 'bandRow'
      | 'firstCol'
      | 'lastCol'
      | 'bandCol',
    label: string
  ) => (
    <label class="flex items-center gap-1 px-1 text-xs">
      <input
        type="checkbox"
        class="accent-accent"
        disabled={ro() || !c.setTableStyle}
        checked={style()?.[key] ?? false}
        onChange={(e) =>
          void c.setTableStyle({ [key]: e.currentTarget.checked })
        }
      />
      {label}
    </label>
  );
  return (
    <>
      <RibbonGroup label="Table style options">
        <div class="grid grid-flow-col grid-rows-2 gap-x-1">
          {option('firstRow', 'Header row')}
          {option('lastRow', 'Total row')}
          {option('bandRow', 'Banded rows')}
          {option('firstCol', 'First column')}
          {option('lastCol', 'Last column')}
          {option('bandCol', 'Banded columns')}
        </div>
      </RibbonGroup>
      <Show when={props.styles.length > 0}>
        <RibbonGroup label="Table styles">
          <RibbonPopover
            label="Table styles"
            text={style()?.name ?? 'Styles'}
            icon={<span class="sr-only">Table styles</span>}
            disabled={ro()}
            testId="pptx-table-styles"
          >
            {(close) => (
              <div class="flex max-h-[60vh] w-72 flex-col overflow-y-auto">
                <For each={props.styles}>
                  {(s) => (
                    <PopoverItem
                      label={s.name}
                      active={s.id === style()?.id}
                      icon={<TableStyleSwatch name={s.name} />}
                      onClick={() => {
                        close();
                        void c.setTableStyle({ style: s.id });
                      }}
                    />
                  )}
                </For>
              </div>
            )}
          </RibbonPopover>
        </RibbonGroup>
      </Show>
      <RibbonGroup label="Cells">
        <>
          <RibbonPopover
            label="Shading"
            icon={<PaintBucket class="size-3.5" />}
            disabled={ro()}
            testId="pptx-cell-shading"
          >
            {(close) => (
              <ColorPicker
                themeGrid={env.themeGrid()}
                standard={env.standardColors}
                noneLabel="No fill"
                onPick={(v) => {
                  close();
                  void c.fillCells(v);
                }}
              />
            )}
          </RibbonPopover>
        </>
        <>
          <RibbonPopover
            label="Borders"
            icon={<BorderIcon edges="all" />}
            disabled={ro()}
            testId="pptx-cell-borders"
          >
            {(close) => (
              <div class="flex w-56 flex-col">
                <For each={BORDER_EDGES}>
                  {([edges, label]) => (
                    <PopoverItem
                      label={label}
                      icon={<BorderIcon edges={edges} />}
                      onClick={() => {
                        close();
                        void c.borderCells(edges);
                      }}
                    />
                  )}
                </For>
                <PopoverItem
                  label="No border"
                  icon={<BorderIcon edges="none" />}
                  onClick={() => {
                    close();
                    void c.borderCells('all', true);
                  }}
                />
                <PopoverLabel>Pen</PopoverLabel>
                <ColorPicker
                  themeGrid={env.themeGrid()}
                  standard={env.standardColors}
                  onPick={(v) => {
                    if (v) c.setBorderPen({ color: v });
                  }}
                />
                <div class="flex flex-wrap gap-1 px-1 pt-1">
                  <For each={[0.5, 1, 1.5, 2.25, 3, 4.5]}>
                    {(w) => (
                      <button
                        type="button"
                        class="rounded-md border border-edge-muted px-1.5 py-0.5 text-xs hover:bg-ink/5"
                        onClick={() => c.setBorderPen({ width: w })}
                      >
                        {w} pt
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </RibbonPopover>
        </>
      </RibbonGroup>
    </>
  );
}

/** A tiny preview of a built-in style from its name (accent color, kind). */
function TableStyleSwatch(props: { name: string }) {
  const env = useRibbon();
  const accent = () => {
    const m = /Accent (\d)/.exec(props.name);
    const slot = m ? `accent${m[1]}` : 'dk1';
    return env.deck()?.themeColors.find(([s]) => s === slot)?.[1] ?? '#444444';
  };
  const kind = () =>
    /Medium|Dark/.test(props.name)
      ? 'solid'
      : /Light/.test(props.name)
        ? 'light'
        : 'grid';
  return (
    <svg viewBox="0 0 16 12" class="h-3 w-4">
      <rect
        x="0"
        y="0"
        width="16"
        height="3"
        fill={kind() === 'grid' ? 'none' : accent()}
        stroke={accent()}
        stroke-width="0.6"
      />
      <For each={[3, 6, 9]}>
        {(y, i) => (
          <rect
            x="0"
            y={y}
            width="16"
            height="3"
            fill={
              kind() === 'solid' && i() % 2 === 0
                ? `color-mix(in srgb, ${accent()} 30%, white)`
                : 'white'
            }
            stroke={kind() === 'light' ? 'none' : accent()}
            stroke-width="0.4"
          />
        )}
      </For>
    </svg>
  );
}

export function TableLayoutTab(props: TableTabProps) {
  const env = useRibbon();
  const c = env.commands;
  const ro = () => env.readonly();
  return (
    <>
      <RibbonGroup label="Table">
        <RibbonPopover
          label="Select"
          text="Select"
          icon={<span class="sr-only">Select</span>}
        >
          {(close) => (
            <div class="flex w-40 flex-col">
              <PopoverItem
                label="Select row"
                onClick={() => {
                  close();
                  props.selectRows();
                }}
              />
              <PopoverItem
                label="Select column"
                onClick={() => {
                  close();
                  props.selectColumns();
                }}
              />
              <PopoverItem
                label="Select table"
                onClick={() => {
                  close();
                  props.selectTable();
                }}
              />
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Rows and columns">
        <RibbonPopover
          label="Delete"
          text="Delete"
          icon={<Trash class="size-3.5" />}
          disabled={ro()}
          testId="pptx-table-delete"
        >
          {(close) => (
            <div class="flex w-40 flex-col">
              <PopoverItem
                label="Delete columns"
                onClick={() => {
                  close();
                  void c.deleteColumns();
                }}
              />
              <PopoverItem
                label="Delete rows"
                onClick={() => {
                  close();
                  void c.deleteRows();
                }}
              />
              <PopoverItem
                label="Delete table"
                onClick={() => {
                  close();
                  void c.deleteTable();
                }}
              />
            </div>
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Insert above"
          disabled={ro()}
          data-testid="pptx-insert-row-above"
          onClick={() => void c.insertRows('above')}
        >
          Insert above
        </RibbonTextButton>
        <RibbonTextButton
          label="Insert below"
          disabled={ro()}
          data-testid="pptx-insert-row-below"
          onClick={() => void c.insertRows('below')}
        >
          Insert below
        </RibbonTextButton>
        <RibbonTextButton
          label="Insert left"
          disabled={ro()}
          onClick={() => void c.insertColumns('left')}
        >
          Insert left
        </RibbonTextButton>
        <RibbonTextButton
          label="Insert right"
          disabled={ro()}
          data-testid="pptx-insert-col-right"
          onClick={() => void c.insertColumns('right')}
        >
          Insert right
        </RibbonTextButton>
      </RibbonGroup>
      <>
        <RibbonGroup label="Merge">
          <RibbonTextButton
            label="Merge cells"
            disabled={ro() || !c.canMerge()}
            data-testid="pptx-merge-cells"
            onClick={() => void c.mergeCells()}
          >
            Merge cells
          </RibbonTextButton>
          <RibbonTextButton
            label="Split cells"
            disabled={ro() || !c.canSplit()}
            onClick={() => void c.splitCells()}
          >
            Split cells
          </RibbonTextButton>
        </RibbonGroup>
      </>
      <>
        <RibbonGroup label="Cell size">
          <NumberField
            label="Row height"
            unit="pt"
            value={c.cellSize()?.h}
            min={4}
            max={2000}
            disabled={ro()}
            onCommit={(h) => void c.setCellSize({ h })}
          />
          <NumberField
            label="Column width"
            unit="pt"
            value={c.cellSize()?.w}
            min={4}
            max={2000}
            disabled={ro()}
            onCommit={(w) => void c.setCellSize({ w })}
          />
          <RibbonTextButton
            label="Distribute rows"
            disabled={ro()}
            onClick={() => void c.distributeRows()}
          >
            Distribute rows
          </RibbonTextButton>
          <RibbonTextButton
            label="Distribute columns"
            disabled={ro()}
            onClick={() => void c.distributeColumns()}
          >
            Distribute columns
          </RibbonTextButton>
        </RibbonGroup>
      </>
      <RibbonGroup label="Alignment">
        <RibbonButton
          label="Align left"
          tooltip="Align left"
          disabled={ro()}
          onClick={() => void c.alignCells('left')}
        >
          <TextAlignLeft />
        </RibbonButton>
        <RibbonButton
          label="Center"
          tooltip="Center"
          disabled={ro()}
          onClick={() => void c.alignCells('center')}
        >
          <TextAlignCenter />
        </RibbonButton>
        <RibbonButton
          label="Align right"
          tooltip="Align right"
          disabled={ro()}
          onClick={() => void c.alignCells('right')}
        >
          <TextAlignRight />
        </RibbonButton>
        <RibbonButton
          label="Align top"
          tooltip="Align top"
          disabled={ro()}
          onClick={() => void c.anchorCells('top')}
        >
          <AlignTop />
        </RibbonButton>
        <RibbonButton
          label="Center vertically"
          tooltip="Center vertically"
          disabled={ro()}
          onClick={() => void c.anchorCells('middle')}
        >
          <AlignCenterVertical />
        </RibbonButton>
        <RibbonButton
          label="Align bottom"
          tooltip="Align bottom"
          disabled={ro()}
          onClick={() => void c.anchorCells('bottom')}
        >
          <AlignBottom />
        </RibbonButton>
      </RibbonGroup>
    </>
  );
}
