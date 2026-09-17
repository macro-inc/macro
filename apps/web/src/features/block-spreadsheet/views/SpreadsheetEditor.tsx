import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui/components/Button';
import { createDeferred, createMemo, createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { SpreadsheetFileMenu } from '../components/SpreadsheetActionMenus';
import { SpreadsheetFindDialog } from '../components/SpreadsheetDialogs';
import { SpreadsheetGrid } from '../components/SpreadsheetGrid';
import { SpreadsheetSheetTabs } from '../components/SpreadsheetSheetTabs';
import {
  FormulaBar,
  SpreadsheetToolbar,
} from '../components/SpreadsheetToolbar';
import {
  SpreadsheetImportDialog,
  SpreadsheetSheetDialog,
} from '../components/SpreadsheetWorkbookDialogs';
import { formulaRangeReference } from '../core/formula-reference';
import {
  cellAddress,
  GRID_COLUMNS,
  positionFromAddress,
  safeCsvValue,
  selectionBounds,
  serializeTable,
} from '../core/grid-selection';
import { SPREADSHEET_MAX_ROWS } from '../core/spreadsheet-document';
import { spreadsheetCursors } from '../core/spreadsheet-presence';
import type { SpreadsheetCommand } from '../core/toolbar-types';
import { SPREADSHEET_MAX_SHEETS } from '../core/workbook-document';
import { createCalculation } from '../primitives/create-calculation';
import { createCalculationStatus } from '../primitives/create-calculation-status';
import { createGridController } from '../primitives/create-grid-controller';
import { createSheetActions } from '../primitives/create-sheet-actions';
import type { SpreadsheetStore } from '../primitives/create-spreadsheet-store';
import { createWorkbookActions } from '../primitives/create-workbook-actions';

export function SpreadsheetEditor(props: {
  store: SpreadsheetStore;
  name: string;
  autoFocus?: boolean;
  onExport: (content: string) => void;
  onExportXlsx: (bytes: Uint8Array) => void;
}) {
  let gridElement: HTMLDivElement | undefined;
  let importInput!: HTMLInputElement;
  const [zoom, setZoom] = createSignal(100);
  const [showGridlines, setShowGridlines] = createSignal(true);
  const [showFormulaBar, setShowFormulaBar] = createSignal(true);
  const [showFormulas, setShowFormulas] = createSignal(false);
  const editable = () => props.store.canEdit();
  const calculation = createCalculation(
    props.store.cells,
    props.store.rowCount,
    { workbook: props.store.workbook, activeSheetId: props.store.activeSheetId }
  );
  const showCalculationStatus = createCalculationStatus(calculation.busy);
  const grid = createGridController({
    ...props.store,
    canEdit: editable,
    sheetId: props.store.activeSheetId,
    copyCells: calculation.copy,
  });
  const values = calculation.values;
  const workbookActions = createWorkbookActions({
    store: props.store,
    values: calculation.workbookValues,
    calculationReady: () => !calculation.busy() && !calculation.error(),
    commit: grid.commit,
    onExport: props.onExportXlsx,
  });
  const actions = createSheetActions(
    {
      cells: props.store.cells,
      values,
      rowCount: props.store.rowCount,
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
  const restoreEditorFocus = () => {
    const pending = pendingMenuAction;
    pendingMenuAction = undefined;
    if (pending) command(pending);
    if (
      actions.findOpen() ||
      workbookActions.preview() ||
      workbookActions.sheetDialog()
    )
      return;
    if (grid.editing() === 'cell') {
      const editor = gridElement?.querySelector('textarea');
      editor?.focus({ preventScroll: true });
    } else focusGrid();
    revealSelection();
  };
  const menuCommand = (action: SpreadsheetCommand) => {
    // Create a new focus owner only after the menu's focus trap has closed.
    if (action.startsWith('insert-')) pendingMenuAction = action;
    else command(action);
  };
  const statisticsSelection = createDeferred(grid.selection, {
    timeoutMs: 100,
  });
  const occupied = createMemo(() =>
    [
      ...new Set([
        ...Object.keys(props.store.cells()),
        ...Object.keys(values()),
      ]),
    ].map((address) => ({ address, position: positionFromAddress(address) }))
  );
  const statistics = createMemo(() => {
    const bounds = selectionBounds(statisticsSelection());
    const selected = occupied()
      .filter(
        ({ position }) =>
          position &&
          position.row >= bounds.top &&
          position.row <= bounds.bottom &&
          position.column >= bounds.left &&
          position.column <= bounds.right
      )
      .map(({ address }) => address);
    const numbers = selected.flatMap((address) => {
      const number = values()[address]?.number;
      return number !== undefined && Number.isFinite(number) ? [number] : [];
    });
    const count = selected.filter(
      (address) =>
        values()[address]?.display || props.store.cells()[address]?.value
    ).length;
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
    const positions = [
      ...new Set([
        ...Object.keys(props.store.cells()),
        ...Object.keys(values()),
      ]),
    ]
      .map(positionFromAddress)
      .filter((position) => position !== undefined);
    const bottom = Math.max(0, ...positions.map((position) => position.row));
    const right = Math.max(0, ...positions.map((position) => position.column));
    const rows = Array.from({ length: bottom + 1 }, (_, row) =>
      Array.from({ length: right + 1 }, (_, column) => {
        const address = cellAddress({ row, column });
        const value = values()[address];
        return safeCsvValue(
          value?.number !== undefined
            ? String(value.number)
            : (value?.display ?? props.store.cells()[address]?.value ?? ''),
          value?.number !== undefined
        );
      })
    );
    props.onExport(serializeTable(rows, ','));
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
    const cells = props.store.cells();
    const sheetId = props.store.activeSheetId();
    const operation = grid.operationRevision();
    if (file.size > 1_000_000) {
      actions.setNotice('Import a CSV up to 1 MB.');
      return;
    }
    try {
      const text = await file.text();
      if (
        !editable() ||
        grid.editing() ||
        selection !== grid.selection() ||
        cells !== props.store.cells() ||
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
      class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-ink"
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
        readonly={!editable() || actions.pending() || !!workbookActions.busy()}
        canUndo={props.store.canUndo()}
        canRedo={props.store.canRedo()}
        cell={activeCell()}
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
      <Show when={showFormulaBar() || (isTouchDevice() && !!grid.editing())}>
        <FormulaBar
          editing={!!grid.editing()}
          complete={calculation.complete}
          selectionRequest={grid.editorSelection()}
          pickingReference={
            grid.pickingReference() ||
            (isTouchDevice() && !!grid.referenceSelection())
          }
          onSelectionChange={grid.setTextSelection}
          address={formulaRangeReference(grid.selection())}
          value={grid.editing() ? grid.draft() : (activeCell()?.value ?? '')}
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
      <Show
        when={props.store.ready()}
        fallback={
          <div
            class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-muted"
            role="status"
          >
            Opening spreadsheet…
          </div>
        }
      >
        <SpreadsheetGrid
          sheetId={props.store.activeSheetId()}
          complete={calculation.complete}
          cells={props.store.cells()}
          zoom={zoom()}
          showGridlines={showGridlines()}
          showFormulas={showFormulas()}
          rowCount={props.store.rowCount()}
          columnWidths={props.store.layout().columnWidths}
          onResizeColumn={props.store.resizeColumn}
          onFill={grid.fill}
          onCopyMetadata={grid.copyMetadata}
          values={values()}
          remoteCursors={remoteCursors()}
          selection={grid.selection()}
          editing={grid.editing() === 'cell'}
          formulaEditing={grid.editing() === 'formula'}
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
          readonly={!editable()}
          canAdd={props.store.sheets().length < SPREADSHEET_MAX_SHEETS}
          onSelect={(id) => {
            workbookActions.selectSheet(id);
            actions.clearNotice();
            focusGrid();
            queueMicrotask(revealSelection);
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
          {props.store.rowCount()} rows × {GRID_COLUMNS} columns
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
                      ? 'Double-click to edit · Shift + click to select'
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
