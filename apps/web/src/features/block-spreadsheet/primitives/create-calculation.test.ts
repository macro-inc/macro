import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpreadsheetCalculation } from '../core/calculation';
import type {
  CalculationOperation,
  CalculationResponse,
} from '../core/calculation-protocol';
import type { SpreadsheetCells } from '../core/spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from '../core/workbook-document';
import { createCalculation } from './create-calculation';

type PendingOperation = {
  operation: CalculationOperation;
  resolve: (response: CalculationResponse) => void;
  reject: (error: Error) => void;
};

function client() {
  const requests: PendingOperation[] = [];
  return {
    requests,
    run: vi.fn(
      (operation: CalculationOperation) =>
        new Promise<CalculationResponse>((resolve, reject) => {
          requests.push({ operation, resolve, reject });
        })
    ),
    dispose: vi.fn(),
  };
}

const cleanups: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.useRealTimers();
});

function setup(initial: SpreadsheetCells = { A1: { value: '1' } }) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [cells, setCells] = createSignal(initial);
    const [rows, setRows] = createSignal(200);
    const clients: ReturnType<typeof client>[] = [];
    const calculation = createCalculation(cells, rows, () => {
      const next = client();
      clients.push(next);
      return next;
    });
    return { calculation, setCells, setRows, clients, dispose };
  });
}

async function respond(
  request: PendingOperation,
  values: SpreadsheetCalculation
) {
  request.resolve({ id: 1, type: 'calculate', values });
  await Promise.resolve();
}

function setupWorkbook() {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [workbook, setWorkbook] = createSignal<SpreadsheetWorkbookSheet[]>([
      {
        id: 'sheet1',
        name: 'Inputs',
        cells: { A1: { value: '5' } },
        layout: { rowCount: 200, columnWidths: {} },
      },
      {
        id: 'stable-second',
        name: 'Summary',
        cells: { A1: { value: '=Inputs!A1*2' } },
        layout: { rowCount: 300, columnWidths: {} },
      },
    ]);
    const [activeSheetId, setActiveSheetId] = createSignal('sheet1');
    const activeSheet = () =>
      workbook().find((sheet) => sheet.id === activeSheetId())!;
    const clients: ReturnType<typeof client>[] = [];
    const calculation = createCalculation(
      () => activeSheet()?.cells ?? {},
      () => activeSheet()?.layout.rowCount ?? 200,
      {
        workbook,
        activeSheetId,
        makeClient: () => {
          const next = client();
          clients.push(next);
          return next;
        },
      }
    );
    return {
      calculation,
      workbook,
      setWorkbook,
      activeSheetId,
      setActiveSheetId,
      clients,
      dispose,
    };
  });
}

async function respondWorkbook(
  request: PendingOperation,
  values: Record<string, SpreadsheetCalculation>
) {
  request.resolve({ id: 1, type: 'calculate-workbook', values });
  await Promise.resolve();
}

describe('reactive workbook calculation', () => {
  it('calculates every sheet together and selects results by stable sheet ID without recalculating on tab switches', async () => {
    const { calculation, clients, setActiveSheetId } = setupWorkbook();
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[0].operation).toEqual({
      type: 'calculate-workbook',
      sheets: [
        {
          id: 'sheet1',
          name: 'Inputs',
          rowCount: 200,
          cells: { A1: { value: '5', format: 'general', decimals: -1 } },
        },
        {
          id: 'stable-second',
          name: 'Summary',
          rowCount: 300,
          cells: {
            A1: { value: '=Inputs!A1*2', format: 'general', decimals: -1 },
          },
        },
      ],
    });
    const values = {
      sheet1: { A1: { display: '5', number: 5 } },
      'stable-second': { A1: { display: '10', number: 10 } },
    };
    await respondWorkbook(clients[0].requests[0], values);
    expect(calculation.values()).toBe(values.sheet1);
    setActiveSheetId('stable-second');
    expect(calculation.values()).toBe(values['stable-second']);
    expect(calculation.workbookValues()).toBe(values);
    setActiveSheetId('sheet1');
    await vi.advanceTimersByTimeAsync(120);
    expect(clients[0].run).toHaveBeenCalledOnce();
    expect(calculation.busy()).toBe(false);
  });

  it('ignores appearance and column width changes on every sheet', async () => {
    const { calculation, clients, setWorkbook } = setupWorkbook();
    await vi.advanceTimersByTimeAsync(60);
    await respondWorkbook(clients[0].requests[0], {});
    setWorkbook((sheets) =>
      sheets.map((sheet) => ({
        ...sheet,
        cells: {
          ...sheet.cells,
          A1: {
            ...sheet.cells.A1,
            bold: true,
            fontSize: 18,
            fillColor: '#ff0000',
          },
          Z100: { value: '', borderTop: true },
        },
        layout: { ...sheet.layout, columnWidths: { 0: 220 } },
      }))
    );
    expect(calculation.busy()).toBe(false);
    await vi.advanceTimersByTimeAsync(120);
    expect(clients[0].run).toHaveBeenCalledOnce();
  });

  it('recalculates inactive-sheet inputs and rejects stale generations after another edit', async () => {
    const { calculation, clients, setWorkbook, setActiveSheetId } =
      setupWorkbook();
    await vi.advanceTimersByTimeAsync(60);
    const initial = {
      sheet1: { A1: { display: '5' } },
      'stable-second': { A1: { display: '10' } },
    };
    await respondWorkbook(clients[0].requests[0], initial);
    setActiveSheetId('stable-second');
    setWorkbook((sheets) =>
      sheets.map((sheet) =>
        sheet.id === 'sheet1'
          ? { ...sheet, cells: { A1: { value: '6' } } }
          : sheet
      )
    );
    expect(calculation.busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    setWorkbook((sheets) =>
      sheets.map((sheet) =>
        sheet.id === 'sheet1'
          ? { ...sheet, cells: { A1: { value: '7' } } }
          : sheet
      )
    );
    await vi.advanceTimersByTimeAsync(60);
    await respondWorkbook(clients[0].requests[1], {
      sheet1: { A1: { display: '6' } },
      'stable-second': { A1: { display: '12' } },
    });
    expect(calculation.values()).toBe(initial['stable-second']);
    expect(calculation.busy()).toBe(true);
    await respondWorkbook(clients[0].requests[2], {
      sheet1: { A1: { display: '7' } },
      'stable-second': { A1: { display: '14' } },
    });
    expect(calculation.values().A1.display).toBe('14');
    expect(calculation.busy()).toBe(false);
  });

  it('keeps stable result identity across rename/reorder and recalculates changed sheet structure', async () => {
    const { calculation, clients, setWorkbook, setActiveSheetId } =
      setupWorkbook();
    await vi.advanceTimersByTimeAsync(60);
    await respondWorkbook(clients[0].requests[0], {
      sheet1: { A1: { display: '5' } },
      'stable-second': { A1: { display: '10' } },
    });
    setActiveSheetId('stable-second');
    setWorkbook((sheets) => [
      {
        ...sheets[1],
        name: 'Renamed',
        layout: { ...sheets[1].layout, rowCount: 400 },
      },
      sheets[0],
    ]);
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[1].operation).toMatchObject({
      type: 'calculate-workbook',
      sheets: [
        { id: 'stable-second', name: 'Renamed', rowCount: 400 },
        { id: 'sheet1', name: 'Inputs' },
      ],
    });
    await respondWorkbook(clients[0].requests[1], {
      'stable-second': { A1: { display: '10' } },
      sheet1: { A1: { display: '5' } },
    });
    expect(calculation.values().A1.display).toBe('10');
  });

  it('passes the current workbook names and active index to formula copying', async () => {
    const { calculation, clients, setActiveSheetId } = setupWorkbook();
    setActiveSheetId('stable-second');
    const copies = [
      {
        from: { row: 0, column: 0 },
        to: { row: 1, column: 0 },
        cell: { value: '=Inputs!A1' },
      },
    ];
    const pending = calculation.copy(copies);
    expect(clients[1].requests[0].operation).toEqual({
      type: 'copy',
      copies,
      context: { sheetNames: ['Inputs', 'Summary'], activeSheet: 1 },
    });
    const edits = { A2: { value: '=Inputs!A2' } };
    clients[1].requests[0].resolve({ id: 1, type: 'copy', edits });
    expect(await pending).toEqual(edits);
  });
});

describe('reactive spreadsheet calculation', () => {
  it('keeps results and idle state when appearance or blank style cells change', async () => {
    const { calculation, clients, setCells } = setup();
    await vi.advanceTimersByTimeAsync(60);
    const result = { A1: { display: '1', number: 1 } };
    await respond(clients[0].requests[0], result);
    expect(calculation.busy()).toBe(false);

    setCells({
      A1: {
        value: '1',
        bold: true,
        strikethrough: true,
        fontSize: 18,
        textColor: '#ff0000',
        format: 'general',
        decimals: -1,
      },
      Z200: { value: '', fillColor: '#000000', borderTop: true },
    });
    expect(calculation.busy()).toBe(false);
    expect(calculation.values()).toBe(result);
    await vi.advanceTimersByTimeAsync(120);
    expect(clients[0].run).toHaveBeenCalledTimes(1);

    setCells({ A1: { value: '1', bold: false } });
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].run).toHaveBeenCalledTimes(1);
    expect(calculation.values()).toBe(result);
  });

  it('does not restart pending real work for an appearance edit', async () => {
    const { calculation, clients, setCells } = setup();
    await vi.advanceTimersByTimeAsync(60);
    const previous = { A1: { display: '1', number: 1 } };
    await respond(clients[0].requests[0], previous);

    setCells({ A1: { value: '=2+2' } });
    expect(calculation.busy()).toBe(true);
    expect(calculation.values()).toBe(previous);
    await vi.advanceTimersByTimeAsync(30);
    setCells({ A1: { value: '=2+2', strikethrough: true } });
    await vi.advanceTimersByTimeAsync(30);
    expect(clients[0].run).toHaveBeenCalledTimes(2);

    setCells({ A1: { value: '=2+2', strikethrough: false, italic: true } });
    const next = { A1: { display: '4', number: 4 } };
    await respond(clients[0].requests[1], next);
    expect(calculation.values()).toBe(next);
    expect(calculation.busy()).toBe(false);
    await vi.advanceTimersByTimeAsync(120);
    expect(clients[0].run).toHaveBeenCalledTimes(2);
  });

  it('recalculates number formats, precision, text interpretation and spill formats', async () => {
    const { clients, setCells } = setup({ A1: { value: '=1/3' } });
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[0].operation).toMatchObject({
      cells: { A1: { value: '=1/3', format: 'general', decimals: -1 } },
    });
    setCells({ A1: { value: '=1/3', format: 'percent' } });
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[1].operation).toMatchObject({
      cells: { A1: { format: 'percent', decimals: -1 } },
    });
    setCells({ A1: { value: '=1/3', format: 'percent', decimals: 4 } });
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[2].operation).toMatchObject({
      cells: { A1: { format: 'percent', decimals: 4 } },
    });
    setCells({
      A1: { value: '=1/3', format: 'text' },
      B1: { value: '', format: 'currency', bold: true },
    });
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[3].operation).toEqual({
      type: 'calculate',
      rowCount: 200,
      cells: {
        A1: { value: '=1/3', format: 'text', decimals: -1 },
        B1: { value: '', format: 'currency', decimals: -1 },
      },
    });
  });

  it('recalculates deletion and row changes without accepting stale responses', async () => {
    const { calculation, clients, setCells, setRows } = setup();
    await vi.advanceTimersByTimeAsync(60);
    const previous = { A1: { display: '1', number: 1 } };
    await respond(clients[0].requests[0], previous);

    setCells({ A1: { value: '2' } });
    await vi.advanceTimersByTimeAsync(60);
    setCells({ A1: { value: '', bold: true } });
    setRows(300);
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].requests[2].operation).toEqual({
      type: 'calculate',
      cells: {},
      rowCount: 300,
    });
    await respond(clients[0].requests[1], { A1: { display: '2', number: 2 } });
    expect(calculation.values()).toBe(previous);
    expect(calculation.busy()).toBe(true);
    await respond(clients[0].requests[2], {});
    expect(calculation.values()).toEqual({});
    expect(calculation.busy()).toBe(false);
  });

  it('clears old values only for the current failure and permits explicit retry', async () => {
    const { calculation, clients, setCells } = setup();
    await vi.advanceTimersByTimeAsync(60);
    const previous = { A1: { display: '1', number: 1 } };
    await respond(clients[0].requests[0], previous);

    setCells({ A1: { value: '2' } });
    await vi.advanceTimersByTimeAsync(60);
    setCells({ A1: { value: '3' } });
    await vi.advanceTimersByTimeAsync(60);
    clients[0].requests[1].reject(new Error('Old worker failed'));
    await Promise.resolve();
    expect(calculation.error()).toBe('');
    expect(calculation.values()).toBe(previous);
    expect(calculation.busy()).toBe(true);

    clients[0].requests[2].reject(new Error('Current calculation failed'));
    await Promise.resolve();
    expect(calculation.error()).toBe('Current calculation failed');
    expect(calculation.values()).toEqual({});
    expect(calculation.busy()).toBe(false);
    calculation.retry();
    expect(calculation.busy()).toBe(true);
    expect(calculation.error()).toBe('');
    await vi.advanceTimersByTimeAsync(60);
    await respond(clients[0].requests[3], { A1: { display: '3', number: 3 } });
    expect(calculation.values().A1.number).toBe(3);
    expect(calculation.busy()).toBe(false);
  });

  it('sends full current styles to formula-aware copy independently of calculation inputs', async () => {
    const { calculation, clients, setCells } = setup({ A1: { value: '=B1' } });
    await vi.advanceTimersByTimeAsync(60);
    await respond(clients[0].requests[0], { A1: { display: '0', number: 0 } });
    const cell = {
      value: '=B1',
      bold: true,
      strikethrough: true,
      fillColor: '#123456',
    };
    setCells({ A1: cell });
    const copies = [
      { from: { row: 0, column: 0 }, to: { row: 1, column: 0 }, cell },
    ];
    const copied = calculation.copy(copies);
    expect(clients[1].requests[0].operation).toEqual({ type: 'copy', copies });
    const edits = { A2: { ...cell, value: '=B2' } };
    clients[1].requests[0].resolve({ id: 1, type: 'copy', edits });
    expect(await copied).toEqual(edits);
    await vi.advanceTimersByTimeAsync(60);
    expect(clients[0].run).toHaveBeenCalledTimes(1);
  });

  it('ignores results arriving after disposal', async () => {
    const { calculation, clients, dispose } = setup();
    await vi.advanceTimersByTimeAsync(60);
    dispose();
    await respond(clients[0].requests[0], { A1: { display: 'late' } });
    expect(calculation.values()).toEqual({});
    for (const current of clients)
      expect(current.dispose).toHaveBeenCalledOnce();
  });
});
