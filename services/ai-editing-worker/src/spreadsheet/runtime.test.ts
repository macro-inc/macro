import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from '@macro-inc/spreadsheet/calculation';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from '@macro-inc/spreadsheet/spreadsheet-document';
import { LoroDoc } from 'loro-crdt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createSpreadsheetStorage,
  runSpreadsheetRequest,
  type SpreadsheetStorage,
} from './runtime';
import { spreadsheetBodySchema } from './schema';

let calculator: SpreadsheetCalculator;
const docs: LoroDoc[] = [];
beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});
afterAll(() => {
  calculator.dispose();
  for (const doc of docs) doc.free();
});
function store() {
  const doc = new LoroDoc();
  docs.push(doc);
  doc.getMap('spreadsheetMeta').set('formatVersion', 1);
  writeSpreadsheetCells(doc, { A1: { value: '5' } });
  const revision = () => Buffer.from(doc.version().encode()).toString('base64');
  const storage: SpreadsheetStorage = {
    load: vi.fn(async () => ({
      snapshot: doc.export({ mode: 'snapshot' }),
      revision: revision(),
    })),
    commit: vi.fn(async (expected, update) => {
      if (expected !== revision()) throw new Error('Conflict');
      doc.import(update);
      return { revision: revision(), applied: true };
    }),
  };
  return { doc, storage, revision };
}
const signal = () => new AbortController().signal;

describe('deterministic spreadsheet worker runtime', () => {
  it('AI can write and reread native mention cells without an open editor', async () => {
    const { doc, storage, revision } = store();
    const value =
      '<m-user-mention>{"userId":"macro|test@macro.com","email":"test@macro.com","displayName":"Taylor"}</m-user-mention>';
    await runSpreadsheetRequest(
      {
        action: 'edit',
        expectedRevision: revision(),
        operations: [
          {
            type: 'set_cells',
            sheetId: 'sheet1',
            cells: [
              { address: 'B1', value },
              { address: 'C1', value: '=B1&" owns this"' },
            ],
          },
        ],
      },
      storage,
      calculator,
      signal()
    );
    expect(readSpreadsheetCells(doc).B1.value).toBe(value);
    const result = calculator.calculate(readSpreadsheetCells(doc));
    expect(result.B1.display).toBe('@Taylor');
    expect(result.C1.display).toBe('@Taylor owns this');
    expect(storage.commit).toHaveBeenCalledOnce();
  });

  it('reads and calculates without calling persistence; edits return the committed revision', async () => {
    const { doc, storage, revision } = store();
    const read = await runSpreadsheetRequest(
      { action: 'read' },
      storage,
      calculator,
      signal()
    );
    const calculation = await runSpreadsheetRequest(
      { action: 'calculate', formulas: [{ formula: '=A1*3' }] },
      storage,
      calculator,
      signal()
    );
    expect(calculation).toMatchObject({
      action: 'calculate',
      results: [{ value: 15 }],
    });
    expect(storage.commit).not.toHaveBeenCalled();
    const edit = await runSpreadsheetRequest(
      {
        action: 'edit',
        expectedRevision: read.revision,
        operations: [
          {
            type: 'set_cells',
            sheetId: 'sheet1',
            cells: [{ address: 'B1', value: '=A1*2' }],
          },
        ],
      },
      storage,
      calculator,
      signal()
    );
    expect(edit).toMatchObject({
      action: 'edit',
      applied: true,
      revision: revision(),
    });
    expect(readSpreadsheetCells(doc).B1.value).toBe('=A1*2');
    expect(storage.commit).toHaveBeenCalledOnce();
  });

  it('rejects stale revisions and failed batches before persistence', async () => {
    const { storage } = store();
    await expect(
      runSpreadsheetRequest(
        {
          action: 'edit',
          expectedRevision: 'stale',
          operations: [{ type: 'delete_sheet', sheetId: 'sheet1' }],
        },
        storage,
        calculator,
        signal()
      )
    ).rejects.toMatchObject({ status: 409 });
    const read = await runSpreadsheetRequest(
      { action: 'read' },
      storage,
      calculator,
      signal()
    );
    await expect(
      runSpreadsheetRequest(
        {
          action: 'edit',
          expectedRevision: read.revision,
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [{ address: 'AA1', value: '5' }],
            },
          ],
        },
        storage,
        calculator,
        signal()
      )
    ).rejects.toThrow('Invalid cell');
    expect(storage.commit).not.toHaveBeenCalled();
  });

  it('does not commit after cancellation', async () => {
    const { storage, revision } = store();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runSpreadsheetRequest(
        {
          action: 'edit',
          expectedRevision: revision(),
          operations: [{ type: 'add_sheet', name: 'Cancelled' }],
        },
        storage,
        calculator,
        controller.signal
      )
    ).rejects.toThrow();
    expect(storage.commit).not.toHaveBeenCalled();
  });

  it('does not commit when synchronous WASM returns after the deadline, even before a timer can fire', async () => {
    const { storage, revision, doc } = store();
    let elapsed = 0;
    const slowCalculator: SpreadsheetCalculator = {
      ...calculator,
      calculateWorkbook(...args) {
        const result = calculator.calculateWorkbook(...args);
        elapsed = 30_001;
        return result;
      },
    };
    await expect(
      runSpreadsheetRequest(
        {
          action: 'edit',
          expectedRevision: revision(),
          operations: [
            {
              type: 'set_cells',
              sheetId: 'sheet1',
              cells: [{ address: 'B1', value: '=A1*2' }],
            },
          ],
        },
        storage,
        slowCalculator,
        signal(),
        { now: () => elapsed }
      )
    ).rejects.toMatchObject({ status: 504 });
    expect(storage.commit).not.toHaveBeenCalled();
    expect(readSpreadsheetCells(doc).B1).toBeUndefined();
  });

  it('uses scoped bearer auth on both read and commit, and preserves server revision conflicts', async () => {
    const { doc, revision } = store();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          snapshot: Buffer.from(doc.export({ mode: 'snapshot' })).toString(
            'base64'
          ),
          revision: revision(),
        })
      )
      .mockResolvedValueOnce(
        new Response('do not expose server internals', { status: 409 })
      );
    const storage = createSpreadsheetStorage(
      'wss://sync.example',
      'document-id',
      'scoped-token',
      fetcher
    );
    expect((await storage.load(signal())).revision).toBe(revision());
    await expect(
      storage.commit(revision(), new Uint8Array([1, 2]), signal())
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://sync.example/document/document-id/spreadsheet-snapshot'
    );
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({
      Authorization: 'Bearer scoped-token',
      'Content-Type': 'application/json',
    });
  });

  it.each([401, 403])(
    'propagates permission denial %i without returning document contents or committing',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private-content', { status }));
      const storage = createSpreadsheetStorage(
        'https://sync.example',
        'doc',
        'denied-token',
        fetcher
      );
      await expect(
        runSpreadsheetRequest({ action: 'read' }, storage, calculator, signal())
      ).rejects.toMatchObject({
        status,
        message: 'You do not have the required access to this spreadsheet.',
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );

  it('strictly validates tool requests before opening a document', () => {
    const base = { documentId: crypto.randomUUID(), documentToken: 'token' };
    expect(
      spreadsheetBodySchema.safeParse({ ...base, request: { action: 'read' } })
        .success
    ).toBe(true);
    expect(
      spreadsheetBodySchema.safeParse({
        ...base,
        request: {
          action: 'edit',
          expectedRevision: 'v',
          operations: [
            {
              type: 'format_cells',
              sheetId: 'sheet1',
              range: 'A1',
              style: { value: 'smuggled' },
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      spreadsheetBodySchema.safeParse({
        ...base,
        request: {
          action: 'calculate',
          formulas: Array.from({ length: 21 }, () => ({ formula: '=1' })),
        },
      }).success
    ).toBe(false);
    expect(
      spreadsheetBodySchema.safeParse({
        ...base,
        request: { action: 'read', script: 'arbitrary code' },
      }).success
    ).toBe(false);
  });
});

it('accepts imported financial styles in AI edits while rejecting unknown border types', () => {
  const body = {
    documentId: crypto.randomUUID(),
    documentToken: 'token',
    request: {
      action: 'edit',
      expectedRevision: 'rev',
      operations: [
        {
          type: 'format_cells',
          sheetId: 'sheet1',
          range: 'A1',
          style: {
            numberFormat: '#,##0.00;[Red](#,##0.00)',
            fontName: 'Calibri',
            borderBottomStyle: 'double',
            borderBottomColor: '#123456',
          },
        },
      ],
    },
  };
  expect(spreadsheetBodySchema.safeParse(body).success).toBe(true);
  body.request.operations[0].style.borderBottomStyle = 'bogus';
  expect(spreadsheetBodySchema.safeParse(body).success).toBe(false);
});
