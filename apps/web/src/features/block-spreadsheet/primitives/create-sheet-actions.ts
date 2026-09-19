import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { CellCopy, SpreadsheetCalculation } from '../core/calculation';
import { formulaRangeReference } from '../core/formula-reference';
import {
  cellAddress,
  GRID_COLUMNS,
  positionFromAddress,
  selectionBounds,
  serializeTable,
} from '../core/grid-selection';
import {
  borderEdits,
  csvImportEdits,
  type FindOptions,
  findCells,
  replaceCellText,
  sortedRangeCopies,
  trimWhitespaceEdits,
} from '../core/sheet-operations';
import {
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_MAX_CELL_LENGTH,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from '../core/spreadsheet-document';
import type { GridController } from './create-grid-controller';

type SheetActionsSource = {
  cells: Accessor<SpreadsheetCells>;
  values: Accessor<SpreadsheetCalculation>;
  canEdit: Accessor<boolean>;
  busy: Accessor<boolean>;
  rowCount: Accessor<number>;
  setCells: (edits: SpreadsheetCellEdits) => void;
  appendRows: (count: number) => void;
  copyCells: (copies: CellCopy[]) => Promise<SpreadsheetCellEdits>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
};

export function createSheetActions(
  source: SheetActionsSource,
  grid: GridController
) {
  const [notice, setNotice] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [findOpen, setFindOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [findOptions, setFindOptions] = createSignal<FindOptions>({
    matchCase: false,
    entireCell: false,
    formulas: false,
  });
  let operation = 0;
  onCleanup(() => {
    operation++;
  });
  let copied: { text: string; metadata: string } | undefined;
  const matches = () =>
    findCells(source.cells(), source.values(), query(), findOptions());
  const matchIndex = () => matches().indexOf(grid.activeAddress());

  function changeFindOptions(patch: Partial<FindOptions>) {
    setFindOptions((current) => ({ ...current, ...patch }));
  }
  function findNext(backwards = false) {
    const addresses = matches();
    if (!addresses.length) return;
    const current = matchIndex();
    const index =
      current < 0
        ? backwards
          ? addresses.length - 1
          : 0
        : (current + (backwards ? -1 : 1) + addresses.length) %
          addresses.length;
    grid.select(positionFromAddress(addresses[index])!);
  }
  function replace(all: boolean) {
    if (!source.canEdit() || !query()) return;
    grid.commit();
    const found = matches();
    const currentIndex = found.indexOf(grid.activeAddress());
    const next =
      currentIndex >= 0 ? found[(currentIndex + 1) % found.length] : undefined;
    const addresses = all
      ? found
      : found.filter((address) => address === grid.activeAddress());
    const edits: SpreadsheetCellEdits = {};
    for (const address of addresses) {
      const original = source.cells()[address]?.value ?? '';
      // Searching displayed results must never turn a formula into a constant.
      if (
        original.startsWith('=') &&
        source.cells()[address]?.format !== 'text' &&
        !findOptions().formulas
      )
        continue;
      const value = replaceCellText(
        original,
        query(),
        replacement(),
        findOptions()
      );
      if (value.length > SPREADSHEET_MAX_CELL_LENGTH) {
        setNotice('Replacement would exceed the 10,000 character cell limit.');
        return;
      }
      if (value !== original) edits[address] = { value };
    }
    source.setCells(edits);
    setNotice(`Replaced text in ${Object.keys(edits).length} cells`);
    if (!all && next) grid.select(positionFromAddress(next)!);
  }
  function borders(border: 'all' | 'outer' | 'none') {
    grid.commit();
    if (source.canEdit())
      source.setCells(borderEdits(grid.selection(), border));
  }
  function clearFormatting() {
    grid.format(SPREADSHEET_DEFAULT_STYLE);
  }
  function trimWhitespace() {
    grid.commit();
    if (!source.canEdit()) return;
    const edits = trimWhitespaceEdits(source.cells(), grid.selection());
    source.setCells(edits);
    setNotice(`Trimmed whitespace in ${Object.keys(edits).length} cells`);
  }
  async function sort(descending: boolean, sheetColumn?: number) {
    grid.commit();
    if (!source.canEdit() || source.busy() || pending()) return;
    const selection = grid.selection();
    if (selectionBounds(selection).top === selectionBounds(selection).bottom) {
      setNotice(
        'Select a range with two or more rows to sort. The active column is the sort key.'
      );
      return;
    }
    const revision = ++operation;
    const gridRevision = grid.operationRevision();
    const before = source.cells();
    setPending(true);
    setNotice('Sorting selected range…');
    try {
      const edits = await source.copyCells(
        sortedRangeCopies(
          before,
          source.values(),
          sheetColumn === undefined
            ? selection
            : {
                anchor: { row: 0, column: 0 },
                focus: { row: source.rowCount() - 1, column: 25 },
              },
          descending,
          sheetColumn
        )
      );
      if (revision !== operation) return;
      if (
        !source.canEdit() ||
        gridRevision !== grid.operationRevision() ||
        grid.editing() ||
        before !== source.cells() ||
        selection !== grid.selection()
      ) {
        setNotice(
          'The sheet or selection changed while sorting. Select the range and try again.'
        );
        return;
      }
      source.setCells(edits);
      setNotice(
        `Sorted selected range by column ${cellAddress(selection.anchor).replace(/\d+/, '')}`
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Unable to sort the selection.'
      );
    } finally {
      if (revision === operation) setPending(false);
    }
  }
  function insertFunction(name: string) {
    grid.commit();
    if (!source.canEdit()) return;
    const selection = grid.selection();
    const { top, bottom, left, right } = selectionBounds(selection);
    if (top !== bottom || left !== right) {
      if (bottom + 1 >= source.rowCount()) source.appendRows(1);
      if (bottom + 1 >= source.rowCount()) {
        setNotice('Choose a range with an empty cell below it.');
        return;
      }
      const destination = { row: bottom + 1, column: left };
      if (source.cells()[cellAddress(destination)]?.value) {
        setNotice(
          'The cell below the selection is occupied. Choose an empty cell and insert the function there.'
        );
        return;
      }
      grid.select(destination);
      grid.beginEdit('cell', `=${name}(${formulaRangeReference(selection)})`);
    } else {
      grid.beginEdit('cell', `=${name}(`);
    }
  }
  function displayedCopy() {
    const { top, bottom, left, right } = selectionBounds(grid.selection());
    return serializeTable(
      Array.from({ length: bottom - top + 1 }, (_, row) =>
        Array.from({ length: right - left + 1 }, (_, column) => {
          const address = cellAddress({
            row: top + row,
            column: left + column,
          });
          return (
            source.values()[address]?.display ??
            source.cells()[address]?.value ??
            ''
          );
        })
      )
    );
  }
  async function copy(cut = false) {
    grid.commit();
    const gridRevision = grid.operationRevision();
    const before = source.cells();
    const selection = grid.selection();
    const text = cut ? grid.copy() : displayedCopy();
    const metadata = grid.copyMetadata(cut);
    try {
      await source.writeClipboard(text);
      copied = { text, metadata };
      if (cut) {
        if (
          !source.canEdit() ||
          gridRevision !== grid.operationRevision() ||
          grid.editing() ||
          before !== source.cells() ||
          selection !== grid.selection()
        )
          return;
        grid.clear();
      }
      setNotice(cut ? 'Cut selection' : 'Copied selection');
    } catch {
      setNotice(
        'Clipboard access is unavailable. Use ⌘/Ctrl+C or ⌘/Ctrl+X in the grid.'
      );
    }
  }
  function copyText(cut = false) {
    const text = cut ? grid.copy() : displayedCopy();
    copied = { text, metadata: grid.copyMetadata(cut) };
    return text;
  }
  function pasteText(text: string, metadata?: string) {
    grid.paste(
      text,
      metadata || (copied?.text === text ? copied.metadata : undefined)
    );
  }
  async function paste(valuesOnly = false) {
    if (!source.canEdit()) return;
    grid.commit();
    const gridRevision = grid.operationRevision();
    const before = source.cells();
    const rows = source.rowCount();
    const selection = grid.selection();
    try {
      const text = await source.readClipboard();
      if (
        !source.canEdit() ||
        gridRevision !== grid.operationRevision() ||
        grid.editing() ||
        before !== source.cells() ||
        rows !== source.rowCount() ||
        grid.selection() !== selection
      )
        return;
      grid.paste(
        text,
        !valuesOnly && copied?.text === text ? copied.metadata : undefined
      );
    } catch {
      setNotice('Clipboard access is unavailable. Use ⌘/Ctrl+V in the grid.');
    }
  }
  function importCsv(text: string) {
    grid.commit();
    if (!source.canEdit()) return;
    try {
      const result = csvImportEdits(text, grid.selection());
      if (result.rowCount > source.rowCount())
        source.appendRows(result.rowCount - source.rowCount());
      source.setCells(result.edits);
      grid.selectRange(result.selection.anchor, result.selection.focus);
      setNotice(`Imported ${Object.keys(result.edits).length} cells`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Unable to import CSV.'
      );
    }
  }
  function selectAll() {
    grid.selectRange(
      { row: 0, column: 0 },
      { row: source.rowCount() - 1, column: GRID_COLUMNS - 1 }
    );
  }

  return {
    notice,
    setNotice,
    pending,
    clearNotice: () => setNotice(''),
    borders,
    clearFormatting,
    trimWhitespace,
    sort,
    insertFunction,
    copy,
    copyText,
    pasteText,
    paste,
    importCsv,
    selectAll,
    findOpen,
    setFindOpen,
    query,
    setQuery,
    replacement,
    setReplacement,
    findOptions,
    changeFindOptions,
    matches,
    matchIndex,
    findNext,
    replace,
  };
}
