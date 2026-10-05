import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cellPlainText } from '@macro-inc/spreadsheet/cell-mentions';
import { parseChartReference } from '@macro-inc/spreadsheet/sheet-drawings';
import { Button } from '@ui/components/Button';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ChartDialog } from '../components/ChartDialog';
import { SpreadsheetFileMenu } from '../components/SpreadsheetActionMenus';
import { SpreadsheetDialog } from '../components/SpreadsheetDialog';
import { SpreadsheetFindDialog } from '../components/SpreadsheetDialogs';
import {
  renderedSelectionCell,
  SpreadsheetGrid,
} from '../components/SpreadsheetGrid';
import type { HeaderAction } from '../components/SpreadsheetHeaderMenu';
import { SpreadsheetSheetTabs } from '../components/SpreadsheetSheetTabs';
import { SpreadsheetSkeleton } from '../components/SpreadsheetSkeleton';
import {
  FormulaBar,
  SpreadsheetToolbar,
} from '../components/SpreadsheetToolbar';
import {
  SpreadsheetImportDialog,
  SpreadsheetSheetDialog,
} from '../components/SpreadsheetWorkbookDialogs';
import type { SpreadsheetCommentsCapability } from '../context/spreadsheet-comments';
import type { SpreadsheetMentions } from '../context/spreadsheet-mentions';
import { cellEditValue } from '../core/cell-input';
import { chartData, createChartReader } from '../core/chart-data';
import { encodeCsv } from '../core/csv-export';
import { formulaRangeReference } from '../core/formula-reference';
import {
  cellAddress,
  positionFromAddress,
  selectionBounds,
} from '../core/grid-selection';
import { selectionToggleStyles } from '../core/selection-formatting';
import {
  listItems,
  type RangeValues,
  rangeAddresses,
  validateInput,
  validationAt,
} from '../core/sheet-validation';
import type { SpreadsheetCommentAnchor } from '../core/spreadsheet-comments';
import {
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from '../core/spreadsheet-document';
import { spreadsheetCursors } from '../core/spreadsheet-presence';
import type { SpreadsheetCommand } from '../core/toolbar-types';
import { SPREADSHEET_MAX_SHEETS } from '../core/workbook-document';
import { CSV_MAX_BYTES } from '../core/workbook-file-types';
import { createCalculation } from '../primitives/create-calculation';
import { createCalculationStatus } from '../primitives/create-calculation-status';
import { createDrawingActions } from '../primitives/create-drawing-actions';
import { createGridController } from '../primitives/create-grid-controller';
import { createSheetActions } from '../primitives/create-sheet-actions';
import type { SpreadsheetStore } from '../primitives/create-spreadsheet-store';
import { createWorkbookActions } from '../primitives/create-workbook-actions';

export function SpreadsheetEditor(props: {
  store: SpreadsheetStore;
  mentions?: SpreadsheetMentions;
  name: string;
  autoFocus?: boolean;
  commentLocation?: SpreadsheetCommentAnchor;
  comments?: SpreadsheetCommentsCapability;
  onExport: (content: string) => void;
  onExportXlsx: (bytes: Uint8Array) => void;
}) {
  let gridElement: HTMLDivElement | undefined;
  let editorElement!: HTMLElement;
  let importInput!: HTMLInputElement;
  const [zoom, setZoom] = createSignal(100);
  const [showGridlines, setShowGridlines] = createSignal(true);
  const [showFormulaBar, setShowFormulaBar] = createSignal(true);
  const [showFormulas, setShowFormulas] = createSignal(false);
  const [structureBusy, setStructureBusy] = createSignal(false);
  const [resize, setResize] = createSignal<{
    sheetId: string;
    axis: 'row' | 'column';
    start: number;
    end: number;
  }>();
  const [resizeSize, setResizeSize] = createSignal('100');
  const editable = () => props.store.canEdit() && !structureBusy();
  const calculation = createCalculation(
    props.store.cells,
    props.store.rowCount,
    {
      workbook: props.store.workbook,
      activeSheetId: props.store.activeSheetId,
      incremental: props.store,
    }
  );
  const showCalculationStatus = createCalculationStatus(calculation.busy);
  // Data validation reads lists and bounds from the rule's own sheet, a
  // named sheet, or a defined name, using calculated values where present.
  const sheetById = (id: string | undefined) =>
    props.store.workbook().find((sheet) => sheet.id === id);
  const rangeValues =
    (homeSheetId: string | undefined): RangeValues =>
    (sheetName, range) => {
      const sheet =
        sheetName === undefined
          ? sheetById(homeSheetId)
          : props.store
              .workbook()
              .find(
                (entry) => entry.name.toLowerCase() === sheetName.toLowerCase()
              );
      if (!sheet) return;
      const results = calculation.workbookValues()[sheet.id] ?? {};
      return rangeAddresses(range).map((address) => {
        const result = results[address];
        if (result) return { text: result.display, number: result.number };
        return {
          text: cellPlainText(sheet.cells[address]?.value ?? '').replace(
            /^'/,
            ''
          ),
        };
      });
    };
  const definedNames = (homeSheetId: string | undefined) => [
    ...(sheetById(homeSheetId)?.metadata?.definedNames ?? []).filter(
      (name) => name.local
    ),
    ...props.store
      .workbook()
      .flatMap((sheet) =>
        (sheet.metadata?.definedNames ?? []).filter((name) => !name.local)
      ),
  ];
  const grid = createGridController({
    ...props.store,
    canEdit: editable,
    sheetId: props.store.activeSheetId,
    copyCells: calculation.copy,
    hiddenRows: () => props.store.activeSheet().metadata?.hiddenRows ?? [],
    hiddenColumns: () =>
      props.store.activeSheet().metadata?.hiddenColumns ?? [],
    validate: (sheetId, address, value) =>
      validateInput(
        validationAt(sheetById(sheetId)?.metadata?.validations, address),
        value,
        rangeValues(sheetId),
        definedNames(sheetId)
      ),
  });
  const values = calculation.values;
  const activeValidation = createMemo(() =>
    validationAt(
      props.store.activeSheet().metadata?.validations,
      grid.activeAddress()
    )
  );
  const activeList = createMemo(() => {
    const rule = activeValidation();
    if (rule?.type !== 'list' || rule.dropdown === false) return;
    const sheetId = props.store.activeSheetId();
    return listItems(rule, rangeValues(sheetId), definedNames(sheetId));
  });
  const inputMessage = () => {
    const rule = activeValidation();
    return rule?.showPrompt && (rule.prompt || rule.promptTitle)
      ? { title: rule.promptTitle, message: rule.prompt ?? '' }
      : undefined;
  };
  const workbookActions = createWorkbookActions({
    store: props.store,
    values: calculation.workbookValues,
    calculationReady: () => !calculation.busy() && !calculation.error(),
    commit: grid.commit,
    onExport: props.onExportXlsx,
  });
  // A drawing to scroll to, select and focus; each request a new nonce.
  const [revealDrawing, setRevealDrawing] = createSignal<{
    id: string;
    nonce: number;
  }>();
  const showDrawing = (id: string) =>
    setRevealDrawing((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }));
  let insertedDrawing: string | undefined;
  const drawingActions = createDrawingActions({
    store: props.store,
    canEdit: editable,
    selection: grid.selection,
    values: calculation.workbookValues,
    setNotice: (message) => actions.setNotice(message),
    onCreated: (id) => {
      insertedDrawing = id;
      showDrawing(id);
    },
  });
  let imageInput!: HTMLInputElement;
  const actions = createSheetActions(
    {
      cells: props.store.cells,
      values,
      rowCount: props.store.rowCount,
      columnCount: props.store.columnCount,
      revision: props.store.revision,
      canEdit: editable,
      busy: () => calculation.busy() || !!calculation.error(),
      setCells: props.store.setCells,
      appendRows: props.store.appendRows,
      copyCells: calculation.copy,
      readClipboard: () => navigator.clipboard.readText(),
      writeClipboard: (text) => navigator.clipboard.writeText(text),
    },
    grid
  );
  const remoteCursors = createMemo(() =>
    spreadsheetCursors(props.store.peers(), props.store.rowCount())
  );
  const activeCell = () => props.store.cells()[grid.activeAddress()];
  const footerNotice = () =>
    workbookActions.busy() ||
    workbookActions.notice() ||
    actions.notice() ||
    grid.notice();
  let pendingMenuAction: SpreadsheetCommand | undefined;
  const focusGrid = () => gridElement?.focus({ preventScroll: true });
  const revealSelection = () =>
    gridElement
      ?.querySelector(`[data-address="${cellAddress(grid.selection().focus)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Comment links drive the imperative grid selection and scroll without moving
  // keyboard focus out of the comment composer.
  createEffect(
    on(
      () => props.commentLocation,
      (location) => {
        if (!location) return;
        const [start, end = start] = location.range.split(':');
        const anchor = positionFromAddress(start);
        const focus = positionFromAddress(end);
        if (!anchor || !focus) return;
        grid.commit();
        props.store.setActiveSheet(location.sheetId);
        queueMicrotask(() => {
          grid.selectRange(anchor, focus);
          revealSelection();
        });
      }
    )
  );
  const addComment = () => {
    grid.commit();
    props.comments?.add(renderedSelectionCell(gridElement, grid.selection()));
  };
  const restoreEditorFocus = () => {
    const pending = pendingMenuAction;
    pendingMenuAction = undefined;
    if (pending) command(pending);
    // A drawing a menu just inserted keeps the focus.
    const inserted = insertedDrawing;
    insertedDrawing = undefined;
    if (inserted) {
      showDrawing(inserted);
      return;
    }
    if (
      actions.findOpen() ||
      workbookActions.preview() ||
      workbookActions.sheetDialog()
    )
      return;
    if (grid.editing() === 'cell') {
      const editor = gridElement?.querySelector<HTMLElement>(
        'textarea, [contenteditable=true]'
      );
      editor?.focus({ preventScroll: true });
    } else if (grid.editing() === 'formula') {
      const editor = editorElement.querySelector<HTMLElement>(
        '[aria-label="Formula bar"]'
      );
      editor?.focus({ preventScroll: true });
      if (editor instanceof HTMLTextAreaElement)
        editor.setSelectionRange(editor.value.length, editor.value.length);
    } else focusGrid();
  };
  const menuCommand = (action: SpreadsheetCommand) => {
    // Create a new focus owner only after the menu's focus trap has closed.
    if (action.startsWith('insert-')) pendingMenuAction = action;
    else command(action);
  };
  const statisticsSelection = createDeferred(grid.selection, {
    timeoutMs: 100,
  });
  const statistics = createMemo(() => {
    const bounds = selectionBounds(statisticsSelection());
    const cells = props.store.cells();
    const results = values();
    let count = 0;
    const numbers: number[] = [];
    const visit = (address: string) => {
      const result = results[address];
      if (result?.display || cells[address]?.value) count++;
      if (result?.number !== undefined && Number.isFinite(result.number))
        numbers.push(result.number);
    };
    const area =
      (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
    // Small selections are walked directly; whole-sheet ones scan only
    // populated cells instead of every empty address.
    if (area <= 50_000) {
      for (let row = bounds.top; row <= bounds.bottom; row++)
        for (let column = bounds.left; column <= bounds.right; column++)
          visit(cellAddress({ row, column }));
    } else {
      const seen = new Set<string>();
      for (const source of [cells, results])
        for (const address in source) {
          if (seen.has(address)) continue;
          seen.add(address);
          const position = positionFromAddress(address);
          if (
            position &&
            position.row >= bounds.top &&
            position.row <= bounds.bottom &&
            position.column >= bounds.left &&
            position.column <= bounds.right
          )
            visit(address);
        }
    }
    const sum = numbers.reduce((total, number) => total + number, 0);
    const format = (value: number) =>
      new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(
        value
      );
    return {
      count,
      numericCount: numbers.length,
      sum: format(sum),
      average: format(sum / (numbers.length || 1)),
    };
  });

  function exportCsv() {
    // Commit first, then wait for the new revision before exporting.
    if (grid.editing()) {
      grid.commit();
      return;
    }
    if (calculation.busy() || calculation.error()) return;
    props.onExport(encodeCsv(props.store.cells(), values()));
  }

  function command(action: SpreadsheetCommand) {
    actions.clearNotice();
    workbookActions.clearNotice();
    grid.commit();
    match(action)
      .with('undo', () => grid.undo())
      .with('redo', () => grid.redo())
      .with('cut', () => {
        void actions.copy(true);
      })
      .with('copy', () => {
        void actions.copy();
      })
      .with('paste', () => {
        void actions.paste();
      })
      .with('paste-values', () => {
        void actions.paste(true);
      })
      .with('clear-values', () => grid.clear())
      .with('clear-formatting', actions.clearFormatting)
      .with('fill-down', () => grid.fillDirection('down'))
      .with('fill-right', () => grid.fillDirection('right'))
      .with('select-all', actions.selectAll)
      .with('find', () => actions.setFindOpen(true))
      .with('export-csv', exportCsv)
      .with('import', () => importInput.click())
      .with('export-xlsx', () => {
        void workbookActions.exportExcel();
      })
      .with('add-rows', () => props.store.appendRows(100))
      .with('toggle-gridlines', () => setShowGridlines((value) => !value))
      .with('toggle-formula-bar', () => setShowFormulaBar((value) => !value))
      .with('toggle-formulas', () => setShowFormulas((value) => !value))
      .with('sort-asc', () => {
        void actions.sort(false);
      })
      .with('sort-desc', () => {
        void actions.sort(true);
      })
      .with('trim-whitespace', actions.trimWhitespace)
      .with('border-all', () => actions.borders('all'))
      .with('border-outer', () => actions.borders('outer'))
      .with('border-none', () => actions.borders('none'))
      .with('insert-sum', () => actions.insertFunction('SUM'))
      .with('insert-average', () => actions.insertFunction('AVERAGE'))
      .with('insert-count', () => actions.insertFunction('COUNT'))
      .with('insert-min', () => actions.insertFunction('MIN'))
      .with('insert-max', () => actions.insertFunction('MAX'))
      .exhaustive();
  }

  async function headerAction(axis: 'row' | 'column', action: HeaderAction) {
    grid.commit();
    if (action === 'copy') {
      command('copy');
      return;
    }
    if (!editable()) return;
    const area = selectionBounds(grid.selection());
    const start = axis === 'row' ? area.top : area.left;
    const end = axis === 'row' ? area.bottom : area.right;
    const sheet = props.store.activeSheet();
    actions.clearNotice();
    try {
      if (
        action === 'insert-before' ||
        action === 'insert-after' ||
        action === 'delete'
      ) {
        // A clone keeps the pre-change cells; the live ones change in place.
        const before = structuredClone(props.store.workbook());
        const beforeRevision = props.store.revision();
        setStructureBusy(true);
        const next = await calculation.changeAxis(before, {
          sheetId: sheet.id,
          axis,
          index: action === 'insert-after' ? end + 1 : start,
          count: end - start + 1,
          kind: action === 'delete' ? 'delete' : 'insert',
        });
        props.store.applyStructure(before, next, beforeRevision);
      } else if (action === 'resize') {
        setResizeSize(
          String(
            axis === 'row'
              ? Math.round(
                  ((sheet.metadata?.rowHeights?.[start] ?? 15.75) * 4) / 3
                )
              : (sheet.layout.columnWidths[start] ?? 100)
          )
        );
        setResize({ sheetId: sheet.id, axis, start, end });
      } else if (action === 'hide' || action === 'unhide') {
        const key = axis === 'row' ? 'hiddenRows' : 'hiddenColumns';
        const hidden =
          action === 'unhide'
            ? []
            : [
                ...new Set([
                  ...(sheet.metadata?.[key] ?? []),
                  ...Array.from(
                    { length: end - start + 1 },
                    (_, i) => start + i
                  ),
                ]),
              ];
        const count =
          axis === 'row' ? props.store.rowCount() : props.store.columnCount();
        if (hidden.length >= count)
          throw new Error(`Keep at least one ${axis} visible.`);
        props.store.setMetadata({ ...sheet.metadata, [key]: hidden });
        if (action === 'hide') {
          const hiddenSet = new Set(hidden);
          let next = 0;
          while (next < count && hiddenSet.has(next)) next++;
          grid.select(
            axis === 'row'
              ? { row: next, column: area.left }
              : { row: area.top, column: next }
          );
        }
      } else if (action === 'autofit') {
        const heights = { ...sheet.metadata?.rowHeights };
        for (let row = start; row <= end; row++) delete heights[row];
        props.store.setMetadata({ ...sheet.metadata, rowHeights: heights });
      } else if (action === 'sort-asc' || action === 'sort-desc') {
        await actions.sort(action === 'sort-desc', start);
      } else command(action);
    } catch (error) {
      actions.setNotice(
        error instanceof Error
          ? error.message
          : 'Unable to change rows or columns.'
      );
    } finally {
      setStructureBusy(false);
    }
  }

  function confirmResize() {
    const selection = resize();
    const value = Number(resizeSize());
    if (
      !selection ||
      !editable() ||
      props.store.activeSheetId() !== selection.sheetId
    ) {
      setResize(undefined);
      return;
    }
    if (
      !Number.isFinite(value) ||
      value < (selection.axis === 'row' ? 21 : 64) ||
      value > (selection.axis === 'row' ? 400 : 640)
    )
      return;
    if (selection.axis === 'row') {
      const metadata = props.store.activeSheet().metadata;
      const heights = { ...metadata?.rowHeights };
      for (let row = selection.start; row <= selection.end; row++)
        heights[row] = (value * 3) / 4;
      props.store.setMetadata({ ...metadata, rowHeights: heights });
    } else
      for (let column = selection.start; column <= selection.end; column++)
        props.store.resizeColumn(column, value);
    setResize(undefined);
  }

  async function importFile(file: File | undefined) {
    if (!file || !editable()) return;
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      actions.setNotice(
        'Choose a .csv or .xlsx file. Legacy .xls and macro-enabled workbooks are not supported.'
      );
      return;
    }
    if (/\.xlsx$/i.test(file.name)) {
      await workbookActions.importExcel(file);
      return;
    }
    const selection = grid.selection();
    const revision = props.store.revision();
    const sheetId = props.store.activeSheetId();
    const operation = grid.operationRevision();
    if (file.size > CSV_MAX_BYTES) {
      actions.setNotice(
        `Import a CSV up to ${CSV_MAX_BYTES / 1024 / 1024} MB.`
      );
      return;
    }
    try {
      const text = await file.text();
      if (
        !editable() ||
        grid.editing() ||
        selection !== grid.selection() ||
        revision !== props.store.revision() ||
        sheetId !== props.store.activeSheetId() ||
        operation !== grid.operationRevision()
      ) {
        actions.setNotice(
          'The sheet or selection changed. Choose the import location and try again.'
        );
        return;
      }
      actions.importCsv(text);
      revealSelection();
    } catch {
      actions.setNotice('Unable to read this CSV file.');
    }
  }

  return (
    <section
      ref={editorElement}
      class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel text-ink"
      aria-label={`${props.name} spreadsheet`}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'f'
        ) {
          event.preventDefault();
          event.stopPropagation();
          command('find');
        }
      }}
    >
      <SpreadsheetDialog
        open={!!resize()}
        onOpenChange={(open) => {
          if (!open) setResize(undefined);
        }}
        onRestoreFocus={focusGrid}
        position="center"
        class="w-80"
      >
        <form
          class="p-5 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            confirmResize();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <SpreadsheetDialog.Title class="font-semibold">
            Resize {resize()?.axis}s
          </SpreadsheetDialog.Title>
          <SpreadsheetDialog.Description class="my-3 text-ink-muted">
            Enter the size in pixels.
          </SpreadsheetDialog.Description>
          <input
            aria-label="Size in pixels"
            type="number"
            required
            min={resize()?.axis === 'row' ? 21 : 64}
            max={resize()?.axis === 'row' ? 400 : 640}
            value={resizeSize()}
            onInput={(event) => setResizeSize(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            class="w-full rounded border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
          />
          <div class="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setResize(undefined)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="strong">
              Apply
            </Button>
          </div>
        </form>
      </SpreadsheetDialog>
      <Show when={props.store.error()}>
        {(error) => (
          <div
            role="alert"
            class="border-y border-failure/20 bg-failure-bg px-4 py-2 text-xs text-failure"
          >
            {error()}
          </div>
        )}
      </Show>
      <Show when={calculation.error()}>
        {(error) => (
          <div
            role="alert"
            class="flex items-center gap-3 border-y border-failure/20 bg-failure-bg px-4 py-2 text-xs text-failure"
          >
            <span>Calculation is unavailable: {error()}</span>
            <Button
              size="sm"
              label="Retry calculation"
              onClick={() => {
                calculation.retry();
              }}
            >
              Retry
            </Button>
          </div>
        )}
      </Show>
      <SpreadsheetToolbar
        onComment={props.comments ? addComment : undefined}
        canComment={props.comments?.canComment()}
        readonly={!editable() || actions.pending() || !!workbookActions.busy()}
        canUndo={props.store.canUndo()}
        canRedo={props.store.canRedo()}
        cell={{
          ...activeCell(),
          ...selectionToggleStyles(props.store.cells(), grid.selection()),
        }}
        zoom={zoom()}
        showGridlines={showGridlines()}
        showFormulaBar={showFormulaBar()}
        showFormulas={showFormulas()}
        onZoom={setZoom}
        onCommand={menuCommand}
        onRestoreFocus={restoreEditorFocus}
        onStyle={(style) => {
          grid.format(style);
          focusGrid();
        }}
        onInsertChart={(type) => {
          grid.commit();
          actions.clearNotice();
          drawingActions.insertChart(type);
        }}
        onInsertImage={() => imageInput.click()}
        onSelectDrawings={
          props.store.activeSheet().metadata?.drawings?.length
            ? () => {
                const [first] = [
                  ...(props.store.activeSheet().metadata?.drawings ?? []),
                ].sort(
                  (a, b) =>
                    a.from.row - b.from.row || a.from.column - b.from.column
                );
                if (first) showDrawing(first.id);
              }
            : undefined
        }
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        class="hidden"
        aria-label="Insert image file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void drawingActions.insertImage(file);
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        class="hidden"
        aria-label="Import spreadsheet file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void importFile(file);
        }}
      />
      <Show
        when={
          showFormulaBar() ||
          grid.editing() === 'formula' ||
          (isTouchDevice() && !!grid.editing())
        }
      >
        <FormulaBar
          mentions={props.mentions}
          editing={!!grid.editing()}
          complete={calculation.complete}
          selectionRequest={grid.editorSelection()}
          pickingReference={
            grid.pickingReference() ||
            (isTouchDevice() && !!grid.referenceSelection())
          }
          onSelectionChange={grid.setTextSelection}
          address={
            grid.editing()
              ? grid.editingAddress()
              : formulaRangeReference(grid.selection())
          }
          value={grid.editing() ? grid.draft() : cellEditValue(activeCell())}
          readonly={!editable()}
          onNavigate={(address) => {
            const parts = address.split(':');
            if (parts.length > 2) return;
            const position = positionFromAddress(parts[0]);
            const last = positionFromAddress(parts[1] ?? parts[0]);
            if (
              !position ||
              !last ||
              position.row >= props.store.rowCount() ||
              last.row >= props.store.rowCount()
            )
              return;
            grid.selectRange(position, last);
            focusGrid();
            revealSelection();
          }}
          onEdit={() => grid.beginEdit('formula')}
          onInput={grid.setDraft}
          onCommit={grid.commit}
          onCancel={grid.cancel}
          onReturnToGrid={focusGrid}
        />
      </Show>
      <Show when={props.store.ready()} fallback={<SpreadsheetSkeleton />}>
        <SpreadsheetGrid
          mentions={props.mentions}
          sheetId={props.store.activeSheetId()}
          complete={calculation.complete}
          cells={props.store.cells()}
          zoom={zoom()}
          showGridlines={showGridlines()}
          showFormulas={showFormulas()}
          rowCount={props.store.rowCount()}
          columnCount={props.store.columnCount()}
          defaultFont={props.store.activeSheet().metadata?.defaultFont}
          columnWidths={props.store.layout().columnWidths}
          rowHeights={props.store.activeSheet().metadata?.rowHeights}
          onResizeRow={(row, height) => {
            if (!editable()) return;
            const metadata = props.store.activeSheet().metadata;
            const rowHeights = { ...metadata?.rowHeights };
            if (height === undefined) delete rowHeights[row];
            else rowHeights[row] = height * 0.75;
            props.store.setMetadata({ ...metadata, rowHeights });
            focusGrid();
          }}
          hiddenRows={props.store.activeSheet().metadata?.hiddenRows}
          hiddenColumns={props.store.activeSheet().metadata?.hiddenColumns}
          canChangeStructure={props.store.canChangeStructure()}
          onCellAction={command}
          onHeaderAction={(axis, action) => void headerAction(axis, action)}
          onResizeColumn={props.store.resizeColumn}
          onFill={grid.fill}
          onCopyMetadata={grid.copyMetadata}
          values={values()}
          notes={props.store.activeSheet().metadata?.notes}
          drawings={props.store.activeSheet().metadata?.drawings}
          image={props.store.image}
          chartData={(chart) =>
            chartData(
              chart,
              createChartReader(
                props.store.workbook,
                calculation.workbookValues,
                props.store.activeSheetId()
              ),
              definedNames(props.store.activeSheetId())
            )
          }
          cellText={(reference) => {
            const range = parseChartReference(reference);
            return range
              ? createChartReader(
                  props.store.workbook,
                  calculation.workbookValues,
                  props.store.activeSheetId()
                )({ ...range, bottom: range.top, right: range.left })?.[0]?.text
              : undefined;
          }}
          onDeleteDrawing={drawingActions.deleteDrawing}
          onPlaceDrawing={editable() ? drawingActions.placeDrawing : undefined}
          onEditDrawing={(id) => drawingActions.setEditing(id)}
          revealDrawing={revealDrawing()}
          inputMessage={inputMessage()}
          listItems={activeList()}
          onPickListItem={(item) => {
            if (!editable()) return;
            grid.commit();
            // A choice is literal text, even one that starts like a formula.
            props.store.setCells({
              [grid.activeAddress()]: {
                value: item.startsWith('=') ? `'${item}` : item,
              },
            });
          }}
          pendingFormulas={
            calculation.busy() &&
            !(props.store.activeSheetId() in calculation.workbookValues())
          }
          remoteCursors={remoteCursors()}
          comments={props.comments}
          selection={grid.selection()}
          editing={grid.editing() === 'cell' && grid.isEditingActiveSheet()}
          formulaEditing={
            !!grid.editing() &&
            (grid.editing() === 'formula' || !grid.isEditingActiveSheet())
          }
          editorSelection={grid.editorSelection()}
          referenceSelection={grid.referenceSelection()}
          pickingReference={grid.pickingReference()}
          onTextSelection={grid.setTextSelection}
          onReferenceStart={grid.beginReference}
          onReferenceMove={grid.updateReference}
          onReferenceEnd={grid.endReference}
          draft={grid.draft()}
          readonly={!editable()}
          onSelect={(position, extend) => {
            actions.clearNotice();
            grid.select(position, extend);
          }}
          onSelectRange={(anchor, focus) => {
            grid.selectRange(anchor, focus);
          }}
          onEdit={() => {
            if (editable()) grid.beginEdit('cell');
          }}
          onDraft={grid.setDraft}
          onCommit={grid.commit}
          onCancel={grid.cancel}
          onMove={(row, column) => {
            grid.move(row, column);
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key.toLowerCase() === 'f'
            ) {
              event.preventDefault();
              command('find');
              return;
            }
            if (
              (event.metaKey || event.ctrlKey) &&
              event.altKey &&
              (event.code === 'KeyM' || event.key.toLowerCase() === 'm') &&
              props.comments?.canComment()
            ) {
              event.preventDefault();
              event.stopPropagation();
              addComment();
              return;
            }
            grid.keyDown(event);
          }}
          onCopy={actions.copyText}
          onPaste={(text, metadata) => {
            actions.pasteText(text, metadata);
          }}
          onClear={grid.clear}
          onGridReady={(element) => {
            gridElement = element;
            if (props.autoFocus) focusGrid();
          }}
        />
      </Show>
      <div class="flex min-h-9 min-w-0 shrink-0 items-center gap-2 border-t border-edge-muted bg-panel px-2 text-[11px] text-ink-muted max-sm:flex-wrap max-sm:gap-x-1 max-sm:gap-y-0 max-sm:px-1 touch:min-h-[48px]">
        <SpreadsheetSheetTabs
          sheets={props.store.sheets()}
          activeSheetId={props.store.activeSheetId()}
          preserveEditorFocus={grid.canPickReference()}
          readonly={!editable()}
          canAdd={props.store.sheets().length < SPREADSHEET_MAX_SHEETS}
          onSelect={(id) => {
            grid.switchSheet(id);
            actions.clearNotice();
            workbookActions.clearNotice();
            if (grid.editing()) queueMicrotask(restoreEditorFocus);
            else {
              focusGrid();
              queueMicrotask(revealSelection);
            }
          }}
          onAdd={() => {
            workbookActions.addSheet();
            queueMicrotask(() => {
              focusGrid();
              revealSelection();
            });
          }}
          onRename={(id) => workbookActions.openSheetDialog('rename', id)}
          onDuplicate={(id) => {
            workbookActions.duplicateSheet(id);
            queueMicrotask(() => {
              focusGrid();
              revealSelection();
            });
          }}
          onDelete={(id) => workbookActions.openSheetDialog('delete', id)}
          onAddRows={
            editable() && props.store.rowCount() < SPREADSHEET_MAX_ROWS
              ? () => {
                  grid.commit();
                  props.store.appendRows(100);
                  focusGrid();
                }
              : undefined
          }
          addRowsLabel={`Add ${Math.min(100, SPREADSHEET_MAX_ROWS - props.store.rowCount())} rows`}
        />
        <span class="hidden shrink-0 whitespace-nowrap xl:inline">
          {props.store.rowCount().toLocaleString('en-US')} rows ×{' '}
          {props.store.columnCount().toLocaleString('en-US')} columns
        </span>
        <Show
          when={editable() && props.store.rowCount() < SPREADSHEET_MAX_ROWS}
        >
          <Button
            size="sm"
            class="max-sm:hidden touch:min-h-[44px]"
            label={`Add ${Math.min(100, SPREADSHEET_MAX_ROWS - props.store.rowCount())} rows`}
            onClick={() => {
              grid.commit();
              props.store.appendRows(100);
              focusGrid();
            }}
          >
            + Add rows
          </Button>
        </Show>
        <Show
          when={
            editable() && props.store.columnCount() < SPREADSHEET_MAX_COLUMNS
          }
        >
          <Button
            size="sm"
            class="max-sm:hidden touch:min-h-[44px]"
            label="Add 26 columns"
            onClick={() => {
              grid.commit();
              props.store.appendColumns(26);
              focusGrid();
            }}
          >
            + Add columns
          </Button>
        </Show>
        <span role="status" class="w-18 min-w-0 truncate max-sm:sr-only">
          {showCalculationStatus() ? 'Calculating…' : ''}
        </span>
        <Show
          when={
            props.store.status() === 'offline' ||
            props.store.status() === 'connecting'
          }
        >
          <span role="status" class="max-sm:order-2 max-sm:w-full max-sm:py-1">
            {props.store.status() === 'offline'
              ? 'Offline · reconnecting'
              : 'Connecting…'}
          </span>
        </Show>
        <Show when={remoteCursors().length > 0}>
          <div class="flex items-center gap-1.5 max-sm:hidden">
            <For each={remoteCursors()}>
              {(peer) => (
                <span
                  title={`${peer.name} · ${cellAddress(peer.selection.focus)}`}
                  class="max-w-32 truncate rounded px-1.5 py-0.5"
                  style={{
                    color: peer.color,
                    background: `color-mix(in srgb, ${peer.color} 12%, transparent)`,
                  }}
                >
                  {peer.name}
                </span>
              )}
            </For>
          </div>
        </Show>
        <div
          class="ml-auto flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap tabular-nums max-sm:order-2 max-sm:w-full max-sm:justify-end max-sm:px-2 max-sm:py-1"
          classList={{
            'max-sm:hidden': !footerNotice() && statistics().count <= 1,
          }}
          aria-live="polite"
        >
          <Show
            when={footerNotice()}
            fallback={
              <>
                <Show when={statistics().count > 1}>
                  <span>
                    Count{' '}
                    <strong class="font-medium text-ink">
                      {statistics().count}
                    </strong>
                  </span>
                </Show>
                <Show when={statistics().numericCount > 1}>
                  <span class="hidden sm:inline">
                    Average{' '}
                    <strong class="font-medium text-ink">
                      {statistics().average}
                    </strong>
                  </span>
                  <span>
                    Sum{' '}
                    <strong class="font-medium text-ink">
                      {statistics().sum}
                    </strong>
                  </span>
                </Show>
                <Show when={statistics().count <= 1}>
                  <span class="hidden sm:inline">
                    {editable()
                      ? 'Type to edit · Shift + click to select'
                      : 'Select cells to explore'}
                  </span>
                </Show>
              </>
            }
          >
            <span class="truncate" title={footerNotice()}>
              {footerNotice()}
            </span>
          </Show>
        </div>
        <div class="shrink-0 border-l border-edge-muted pl-1 max-sm:order-1">
          <SpreadsheetFileMenu
            readonly={
              !editable() || actions.pending() || !!workbookActions.busy()
            }
            canExport={
              props.store.ready() &&
              !calculation.busy() &&
              !calculation.error() &&
              !grid.editing() &&
              !workbookActions.busy()
            }
            onCommand={menuCommand}
            onRestoreFocus={restoreEditorFocus}
          />
        </div>
      </div>
      <ChartDialog
        settings={(() => {
          const id = drawingActions.editing();
          return id ? drawingActions.chartSettings(id) : undefined;
        })()}
        onApply={(settings) => {
          const id = drawingActions.editing();
          return id ? drawingActions.applyChart(id, settings) : undefined;
        }}
        onClose={() => drawingActions.setEditing(undefined)}
        onRestoreFocus={() => {
          const id = revealDrawing()?.id;
          if (id) showDrawing(id);
          else focusGrid();
        }}
      />
      <SpreadsheetSheetDialog
        onRestoreFocus={() => {
          focusGrid();
          revealSelection();
        }}
        dialog={workbookActions.sheetDialog()}
        name={workbookActions.sheetName()}
        onName={workbookActions.setSheetName}
        error={workbookActions.sheetError()}
        readonly={!editable()}
        onConfirm={workbookActions.confirmSheetDialog}
        onClose={workbookActions.closeSheetDialog}
      />
      <SpreadsheetImportDialog
        onRestoreFocus={() => {
          focusGrid();
          revealSelection();
        }}
        preview={workbookActions.preview()}
        mode={workbookActions.importMode()}
        onMode={workbookActions.setImportMode}
        error={workbookActions.importError()}
        readonly={!editable()}
        importing={workbookActions.importing()}
        progress={workbookActions.importProgress()}
        onConfirm={workbookActions.confirmImport}
        onClose={workbookActions.closePreview}
      />
      <SpreadsheetFindDialog
        onRestoreFocus={() => {
          focusGrid();
          revealSelection();
        }}
        open={actions.findOpen()}
        onClose={() => actions.setFindOpen(false)}
        query={actions.query()}
        onQuery={(value) => {
          actions.setQuery(value);
          actions.clearNotice();
        }}
        replacement={actions.replacement()}
        onReplacement={actions.setReplacement}
        options={actions.findOptions()}
        onOptions={actions.changeFindOptions}
        matchCount={actions.matches().length}
        matchIndex={actions.matchIndex()}
        readonly={!editable()}
        notice={actions.notice()}
        onFind={(backwards) => {
          actions.findNext(backwards);
          revealSelection();
        }}
        onReplace={(all) => {
          actions.replace(all);
          revealSelection();
        }}
      />
    </section>
  );
}
