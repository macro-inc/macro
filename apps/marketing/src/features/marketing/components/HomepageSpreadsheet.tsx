import AlignMiddle from '@phosphor/align-center-vertical-simple.svg';
import ArrowBendDownRight from '@phosphor/arrow-bend-down-right.svg';
import ArrowClockwise from '@phosphor/arrow-clockwise.svg';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Clipboard from '@phosphor/clipboard-text.svg';
import Download from '@phosphor/download-simple.svg';
import Eye from '@phosphor/eye.svg';
import FunctionIcon from '@phosphor/function.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import Minus from '@phosphor/minus.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import Plus from '@phosphor/plus.svg';
import Sigma from '@phosphor/sigma.svg';
import Table from '@phosphor/table.svg';
import TextColor from '@phosphor/text-a-underline.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextB from '@phosphor/text-b.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { CUSTOMERS, type DemoCell } from './spreadsheet-demo-data';
import './homepage-spreadsheet.css';

const NAME = 'Customers to reach';
const COLUMNS = Array.from({ length: 26 }, (_, column) =>
  String.fromCharCode(65 + column)
);
const WIDTHS = COLUMNS.map(
  (_, index) => [150, 120, 210, 120, 90, 80][index] ?? 100
);
const GRID_WIDTH = 46 + WIDTHS.reduce((sum, width) => sum + width, 0);
const position = (address: string) => {
  const match = /^([A-Z])(\d+)$/i.exec(address.trim());
  return match
    ? {
        column: match[1].toUpperCase().charCodeAt(0) - 65,
        row: Number(match[2]) - 1,
      }
    : undefined;
};
const address = (row: number, column: number) => `${COLUMNS[column]}${row + 1}`;

function Tool(props: {
  label: string;
  children: JSX.Element;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  menu?: boolean;
  class?: string;
}) {
  return (
    <button
      type="button"
      class={`homepage-sheet-tool ${props.menu ? 'homepage-sheet-menu' : ''} ${props.class ?? ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      {props.children}
      <Show when={props.menu}>
        <span class="homepage-sheet-caret" />
      </Show>
    </button>
  );
}
function Divider() {
  return <span class="homepage-sheet-divider" aria-hidden="true" />;
}

/** Small, frozen spreadsheet preview. The website never loads app stores or a WASM calculator. */
export default function HomepageSpreadsheet() {
  const [cells, setCells] = createSignal<Record<string, DemoCell>>({
    ...CUSTOMERS,
  });
  const [selected, setSelected] = createSignal('A1');
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [history, setHistory] = createSignal<Record<string, DemoCell>[]>([]);
  const [future, setFuture] = createSignal<Record<string, DemoCell>[]>([]);
  const [rows, setRows] = createSignal(200);
  const [firstRow, setFirstRow] = createSignal(0);
  const [notice, setNotice] = createSignal('');
  let grid: HTMLDivElement | undefined;
  let editInput: HTMLInputElement | undefined;
  const active = () => cells()[selected()] ?? { value: '' };
  const selectedPosition = () => position(selected()) ?? { row: 0, column: 0 };
  const visibleRows = createMemo(() =>
    Array.from(
      { length: Math.min(30, rows() - firstRow()) },
      (_, index) => firstRow() + index
    )
  );

  function change(next: Record<string, DemoCell>) {
    setHistory((previous) => [...previous.slice(-39), cells()]);
    setFuture([]);
    setCells(next);
  }
  function commit() {
    if (!editing()) return;
    if (draft() !== active().value)
      change({ ...cells(), [selected()]: { ...active(), value: draft() } });
    setEditing(false);
  }
  function select(next: string) {
    commit();
    setSelected(next);
    setNotice('');
  }
  function beginEdit(value = active().value) {
    setDraft(value);
    setEditing(true);
    queueMicrotask(() => editInput?.focus({ preventScroll: true }));
  }
  function move(rowDelta: number, columnDelta: number) {
    const current = selectedPosition();
    select(
      address(
        Math.max(0, Math.min(rows() - 1, current.row + rowDelta)),
        Math.max(0, Math.min(25, current.column + columnDelta))
      )
    );
    const rowTop = selectedPosition().row * 21;
    if (grid && rowTop < grid.scrollTop) grid.scrollTop = rowTop;
    else if (grid && rowTop + 45 > grid.scrollTop + grid.clientHeight)
      grid.scrollTop = rowTop + 45 - grid.clientHeight;
  }
  function style(patch: Partial<DemoCell>) {
    commit();
    change({ ...cells(), [selected()]: { ...active(), ...patch } });
    grid?.focus({ preventScroll: true });
  }
  function undo() {
    const previous = history().at(-1);
    if (!previous) return;
    setFuture((next) => [...next, cells()]);
    setHistory((next) => next.slice(0, -1));
    setCells(previous);
  }
  function redo() {
    const next = future().at(-1);
    if (!next) return;
    setHistory((previous) => [...previous, cells()]);
    setFuture((previous) => previous.slice(0, -1));
    setCells(next);
  }
  function display(cell?: DemoCell) {
    if (!cell) return '';
    const number = Number(cell.value);
    if (cell.value && cell.format && Number.isFinite(number)) {
      if (cell.format === 'currency')
        return number.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: cell.decimals ?? 2,
        });
      if (cell.format === 'percent')
        return `${(number * 100).toFixed(cell.decimals ?? 2)}%`;
      return number.toLocaleString('en-US', {
        minimumFractionDigits: cell.decimals ?? 0,
        maximumFractionDigits: cell.decimals ?? 0,
      });
    }
    return cell.value;
  }
  function exportCsv() {
    commit();
    const content = Array.from({ length: 8 }, (_, row) =>
      COLUMNS.slice(0, 6)
        .map(
          (column) =>
            `"${(cells()[`${column}${row + 1}`]?.value ?? '').replaceAll('"', '""')}"`
        )
        .join(',')
    ).join('\n');
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${NAME}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function previewOnly() {
    setNotice('This preview supports cell edits and formatting.');
  }

  return (
    <div class="relative pb-24">
      <div class="workspace-demo homepage-spreadsheet">
        <div class="homepage-compose-status">
          <span>{NAME}</span>
          <span>Interactive demo</span>
        </div>
        <section
          class="homepage-sheet-editor"
          aria-label={`${NAME} spreadsheet`}
        >
          <div
            class="homepage-sheet-toolbar"
            role="toolbar"
            aria-label="Spreadsheet formatting"
          >
            <Tool label="Undo" disabled={!history().length} onClick={undo}>
              <ArrowCounterClockwise />
            </Tool>
            <Tool label="Redo" disabled={!future().length} onClick={redo}>
              <ArrowClockwise />
            </Tool>
            <Tool label="Paste special" onClick={previewOnly}>
              <Clipboard />
            </Tool>
            <Divider />
            <Tool label="Zoom" menu onClick={previewOnly}>
              <span class="homepage-sheet-zoom">100%</span>
            </Tool>
            <Tool label="View options" onClick={previewOnly}>
              <Eye />
            </Tool>
            <Divider />
            <Tool
              label="Format as currency"
              onClick={() => style({ format: 'currency' })}
            >
              $
            </Tool>
            <Tool
              label="Format as percent"
              onClick={() => style({ format: 'percent' })}
            >
              %
            </Tool>
            <Tool
              label="Decrease decimal places"
              onClick={() =>
                style({ decimals: Math.max(0, (active().decimals ?? 2) - 1) })
              }
            >
              <span class="homepage-sheet-decimal">.0←</span>
            </Tool>
            <Tool
              label="Increase decimal places"
              onClick={() =>
                style({ decimals: Math.min(10, (active().decimals ?? 2) + 1) })
              }
            >
              <span class="homepage-sheet-decimal">.00→</span>
            </Tool>
            <Tool
              label="Number format"
              menu
              onClick={() => style({ format: 'number' })}
            >
              123
            </Tool>
            <Divider />
            <Tool label="Font family" menu onClick={previewOnly}>
              <span class="homepage-sheet-font">Sans serif</span>
            </Tool>
            <Tool
              label="Decrease font size"
              onClick={() =>
                style({ fontSize: Math.max(8, (active().fontSize ?? 10) - 1) })
              }
            >
              <Minus />
            </Tool>
            <input
              class="homepage-sheet-font-size"
              aria-label="Font size"
              type="number"
              min="8"
              max="36"
              value={active().fontSize ?? 10}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value))
                  style({ fontSize: Math.max(8, Math.min(36, value)) });
              }}
            />
            <Tool
              label="Increase font size"
              onClick={() =>
                style({ fontSize: Math.min(36, (active().fontSize ?? 10) + 1) })
              }
            >
              <Plus />
            </Tool>
            <Divider />
            <Tool
              label="Bold"
              pressed={!!active().bold}
              onClick={() => style({ bold: !active().bold })}
            >
              <TextB />
            </Tool>
            <Tool
              label="Italic"
              pressed={!!active().italic}
              onClick={() => style({ italic: !active().italic })}
            >
              <TextItalic />
            </Tool>
            <Tool
              label="Strikethrough"
              pressed={!!active().strikethrough}
              onClick={() => style({ strikethrough: !active().strikethrough })}
            >
              <TextStrikethrough />
            </Tool>
            <Tool
              label="Underline"
              pressed={!!active().underline}
              onClick={() => style({ underline: !active().underline })}
            >
              <TextUnderline />
            </Tool>
            <Tool label="Text color" menu onClick={previewOnly}>
              <TextColor />
            </Tool>
            <Tool label="Fill color" menu onClick={previewOnly}>
              <PaintBucket />
            </Tool>
            <Divider />
            <Tool label="Borders" menu onClick={previewOnly}>
              <Table />
            </Tool>
            <Tool label="Horizontal alignment" menu onClick={previewOnly}>
              <TextAlignLeft />
            </Tool>
            <Tool label="Vertical alignment" menu onClick={previewOnly}>
              <AlignMiddle />
            </Tool>
            <Tool label="Wrap text" onClick={previewOnly}>
              <ArrowBendDownRight />
            </Tool>
            <Divider />
            <Tool label="Functions" menu onClick={previewOnly}>
              <Sigma />
            </Tool>
            <Tool label="Format and data" menu onClick={previewOnly}>
              <Table />
            </Tool>
            <Tool label="Find and replace" onClick={previewOnly}>
              <MagnifyingGlass />
            </Tool>
          </div>
          <div class="homepage-sheet-formula">
            <input
              aria-label="Go to cell"
              value={selected()}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const next = position(event.currentTarget.value);
                if (next && next.row >= 0 && next.row < rows())
                  select(address(next.row, next.column));
                event.currentTarget.value = selected();
              }}
            />
            <FunctionIcon />
            <input
              aria-label="Formula bar"
              value={editing() ? draft() : active().value}
              placeholder="Enter a value or formula, like =SUM(A1:A10)"
              onFocus={() => {
                setDraft(active().value);
                setEditing(true);
              }}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commit();
                  grid?.focus();
                } else if (event.key === 'Escape') {
                  setEditing(false);
                  grid?.focus();
                }
              }}
            />
          </div>
          <div
            ref={grid}
            role="grid"
            aria-label="Spreadsheet"
            aria-rowcount={rows() + 1}
            aria-colcount="27"
            tabIndex={0}
            class="homepage-sheet-grid"
            onScroll={(event) =>
              setFirstRow(
                Math.max(0, Math.floor(event.currentTarget.scrollTop / 21) - 2)
              )
            }
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 'z'
              ) {
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
                return;
              }
              const delta: Record<string, [number, number]> = {
                ArrowDown: [1, 0],
                ArrowUp: [-1, 0],
                ArrowRight: [0, 1],
                ArrowLeft: [0, -1],
                Tab: [0, event.shiftKey ? -1 : 1],
              };
              if (delta[event.key]) {
                event.preventDefault();
                move(...delta[event.key]);
              } else if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault();
                beginEdit();
              } else if (event.key === 'Backspace' || event.key === 'Delete') {
                event.preventDefault();
                change({
                  ...cells(),
                  [selected()]: { ...active(), value: '' },
                });
              } else if (
                event.key.length === 1 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey
              ) {
                event.preventDefault();
                beginEdit(event.key);
              }
            }}
          >
            <div
              class="homepage-sheet-grid-content"
              style={{
                width: `${GRID_WIDTH}px`,
                height: `${rows() * 21 + 24}px`,
              }}
            >
              <div
                role="row"
                class="homepage-sheet-column-row"
                style={{
                  'grid-template-columns': `46px ${WIDTHS.map((width) => `${width}px`).join(' ')}`,
                }}
              >
                <div role="columnheader" class="homepage-sheet-corner">
                  ▦
                </div>
                <For each={COLUMNS}>
                  {(column, index) => (
                    <div
                      role="columnheader"
                      classList={{
                        'homepage-sheet-column-selected':
                          selectedPosition().column === index(),
                      }}
                    >
                      {column}
                    </div>
                  )}
                </For>
              </div>
              <For each={visibleRows()}>
                {(row) => (
                  <div
                    role="row"
                    aria-rowindex={row + 2}
                    class="homepage-sheet-row"
                    style={{
                      top: `${24 + row * 21}px`,
                      'grid-template-columns': `46px ${WIDTHS.map((width) => `${width}px`).join(' ')}`,
                    }}
                  >
                    <div role="rowheader">{row + 1}</div>
                    <For each={COLUMNS}>
                      {(_, column) => {
                        const key = address(row, column());
                        const cell = () => cells()[key];
                        return (
                          <div
                            role="gridcell"
                            aria-label={`${key}${cell()?.value ? `: ${cell()?.value}` : ''}`}
                            aria-selected={selected() === key}
                            class="homepage-sheet-cell"
                            onClick={() => {
                              select(key);
                              grid?.focus({ preventScroll: true });
                            }}
                            onDblClick={() => beginEdit()}
                            style={{
                              'font-weight': cell()?.bold ? '700' : '400',
                              'font-style': cell()?.italic
                                ? 'italic'
                                : 'normal',
                              'text-decoration': [
                                cell()?.underline ? 'underline' : '',
                                cell()?.strikethrough ? 'line-through' : '',
                              ].join(' '),
                              'font-size': `${((cell()?.fontSize ?? 10) * 4) / 3}px`,
                              'text-align': cell()?.format ? 'right' : 'left',
                            }}
                          >
                            <Show
                              when={editing() && selected() === key}
                              fallback={display(cell())}
                            >
                              <input
                                ref={editInput}
                                aria-label={`Edit ${key}`}
                                value={draft()}
                                onClick={(event) => event.stopPropagation()}
                                onInput={(event) =>
                                  setDraft(event.currentTarget.value)
                                }
                                onBlur={commit}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === 'Enter' ||
                                    event.key === 'Tab'
                                  ) {
                                    event.preventDefault();
                                    commit();
                                    move(
                                      event.key === 'Enter' ? 1 : 0,
                                      event.key === 'Tab' ? 1 : 0
                                    );
                                    grid?.focus({ preventScroll: true });
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setEditing(false);
                                    grid?.focus({ preventScroll: true });
                                  }
                                }}
                              />
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div class="homepage-sheet-footer">
            <Tool label="Add sheet" onClick={previewOnly}>
              <Plus />
            </Tool>
            <div role="tablist" aria-label="Workbook sheets">
              <button
                type="button"
                role="tab"
                aria-selected="true"
                class="homepage-sheet-tab"
              >
                Top customers
              </button>
            </div>
            <Tool label="Sheet actions for Top customers" onClick={previewOnly}>
              <CaretDown />
            </Tool>
            <span class="homepage-sheet-row-count">
              {rows()} rows × 26 columns
            </span>
            <button
              type="button"
              class="homepage-sheet-add-rows"
              onClick={() => setRows((value) => value + 100)}
            >
              + Add rows
            </button>
            <span class="homepage-sheet-notice" role="status">
              {notice() || 'Type to edit · Shift + click to select'}
            </span>
            <Tool label="Export CSV" onClick={exportCsv}>
              <Download />
            </Tool>
          </div>
        </section>
      </div>
      <div class="pointer-events-none absolute bottom-0 left-2 z-10 text-ink-muted sm:left-6">
        <span class="sr-only">Interactive demo — try editing a cell.</span>
        <svg
          class="h-[160px] w-[200px] -rotate-6"
          viewBox="0 0 200 165"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          {/* Hand-lettered so the marker note stays consistent without a font download. */}
          <path d="M59 112C8 99 8 47 38 7M22 13C28 12 33 9 38 7C38 14 39 19 41 24" />
          <g transform="translate(0 40)">
            <path d="M70 70C84 68 98 67 108 69M91 69L87 102" />
            <path d="M107 81L104 101M106 88C113 76 120 77 123 80" />
            <path d="M127 80C124 89 125 94 130 94C137 94 141 82 143 78M143 78C137 101 135 115 123 116C116 116 116 111 121 108" />
            <path d="M163 85L160 103M165 75L165 76M181 75L174 98Q174 105 182 100M167 85L186 83" />
          </g>
        </svg>
      </div>
    </div>
  );
}
