import { afterEach, expect, test } from 'bun:test';
import {
  DocumentEditRefusedError,
  EditOutcomeUnknownError,
  Macro,
  RevisionConflictError,
} from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-user-token',
    hosts: { storage: 'https://storage.example.test' },
  });

const sheetSummary = {
  id: 'sheet1',
  name: 'Sales',
  rowCount: 200,
  columnCount: 26,
  usedRange: 'A1:D20',
  populatedCells: 80,
  formulaCells: 19,
  errorCells: 0,
};

test('read sends the sheet and ranges and returns the workbook', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      action: 'read',
      revision: 'r1',
      sheets: [sheetSummary],
      ranges: [
        {
          sheetId: 'sheet1',
          sheetName: 'Sales',
          range: 'D21',
          truncated: false,
          cells: [
            {
              address: 'D21',
              source: '=SUM(D2:D20)',
              formula: '=SUM(D2:D20)',
              type: 'number',
              value: 1200,
              display: '1,200',
            },
          ],
        },
      ],
      warnings: [],
    });
  }) as typeof fetch;

  const sheet = macro().documents.spreadsheet(macro().documents.byId('doc-1'));
  const read = await sheet.read({ sheet: sheetSummary, ranges: ['D21'] });

  expect(read.revision).toBe('r1');
  expect(read.ranges[0].cells[0].display).toBe('1,200');
  expect('action' in read).toBe(false);
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/doc-1/spreadsheet/read',
  );
  expect(await requests[0].json()).toEqual({
    sheetId: 'sheet1',
    ranges: ['D21'],
  });
});

test('calculate sends formula strings as formulas with overrides', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      action: 'calculate',
      revision: 'r1',
      results: [
        {
          formula: '=SUM(D2:D20)',
          type: 'number',
          value: 1320,
          display: '1,320',
        },
      ],
      warnings: [],
    });
  }) as typeof fetch;

  const { results } = await macro()
    .documents.spreadsheet(macro().documents.byId('doc-1'))
    .calculate(['=SUM(D2:D20)'], {
      sheet: 'Sales',
      overrides: [
        { sheetId: 'Sales', cells: [{ address: 'B1', value: '13.2' }] },
      ],
    });

  expect(results[0].display).toBe('1,320');
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/doc-1/spreadsheet/calculate',
  );
  expect(await requests[0].json()).toEqual({
    sheetId: 'Sales',
    formulas: [{ formula: '=SUM(D2:D20)' }],
    overrides: [
      { sheetId: 'Sales', cells: [{ address: 'B1', value: '13.2' }] },
    ],
  });
});

test('applyEdits sends the batch with its revision and links the result', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      action: 'edit',
      revision: 'r2',
      applied: true,
      changes: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          summary: 'Set 1 cell',
          range: 'D21',
        },
      ],
      sheets: [sheetSummary],
      warnings: [],
    });
  }) as typeof fetch;

  const edited = await macro()
    .documents.spreadsheet(macro().documents.byId('doc-1'))
    .applyEdits(
      [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          cells: [{ address: 'D21', value: '=SUM(D2:D20)' }],
        },
      ],
      { expectedRevision: 'r1' },
    );

  expect(edited.revision).toBe('r2');
  expect(edited.webUrl).toBe('https://macro.com/app/spreadsheet/doc-1');
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/doc-1/spreadsheet/edits',
  );
  expect(await requests[0].json()).toEqual({
    expectedRevision: 'r1',
    operations: [
      {
        type: 'set_cells',
        sheetId: 'sheet1',
        cells: [{ address: 'D21', value: '=SUM(D2:D20)' }],
      },
    ],
  });
});

test('a stale revision raises a revision conflict', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { message: 'The spreadsheet changed since it was read.' },
      { status: 409 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.spreadsheet(macro().documents.byId('doc-1'))
      .applyEdits([{ type: 'add_sheet', name: 'Forecast' }], {
        expectedRevision: 'r1',
      }),
  ).rejects.toBeInstanceOf(RevisionConflictError);
});

test('an invalid batch is an API error, not an unknown outcome', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { message: 'Unknown sheet Forecast.' },
      { status: 400 },
    )) as typeof fetch;

  const edit = macro()
    .documents.spreadsheet(macro().documents.byId('doc-1'))
    .applyEdits([{ type: 'rename_sheet', sheetId: 'Forecast', name: 'Plan' }], {
      expectedRevision: 'r1',
    });

  await expect(edit).rejects.toBeInstanceOf(MacroApiError);
  await expect(edit).rejects.not.toBeInstanceOf(EditOutcomeUnknownError);
  await expect(edit).rejects.toThrow('Unknown sheet Forecast.');
});

test('a failed save leaves the outcome unknown', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { message: 'The spreadsheet operation failed.' },
      { status: 502 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.spreadsheet(macro().documents.byId('doc-1'))
      .applyEdits([{ type: 'add_sheet', name: 'Forecast' }], {
        expectedRevision: 'r1',
      }),
  ).rejects.toBeInstanceOf(EditOutcomeUnknownError);
});

test('createSpreadsheet returns a spreadsheet handle in the project', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({ documentId: 'doc-2' });
  }) as typeof fetch;

  const sheet = await macro().documents.createSpreadsheet({
    name: 'Q4 budget',
    project: macro().projects.byId('0199a1b2-0000-7000-8000-000000000001'),
  });

  expect(sheet.webUrl()).toBe('https://macro.com/app/spreadsheet/doc-2');
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/create_spreadsheet',
  );
  expect(await requests[0].json()).toEqual({
    documentName: 'Q4 budget',
    projectId: '0199a1b2-0000-7000-8000-000000000001',
  });
});

test('edit sends instructions to the spreadsheet writer and links the result', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      revision: 'r2',
      applied: true,
      changes: [
        {
          type: 'set_cells',
          sheetId: 'sheet1',
          summary: 'Set 2 cell(s) in “Sales”.',
          range: 'A21:D21',
        },
      ],
      sheets: [sheetSummary],
      warnings: [],
    });
  }) as typeof fetch;

  const edited = await macro()
    .documents.spreadsheet(macro().documents.byId('doc-1'))
    .edit('Add a Total row that sums the Cost column.');

  expect(edited.changes[0].range).toBe('A21:D21');
  expect(edited.webUrl).toBe('https://macro.com/app/spreadsheet/doc-1');
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/doc-1/spreadsheet/ai-edit',
  );
  expect(await requests[0].json()).toEqual({
    instructions: 'Add a Total row that sums the Cost column.',
  });
});

test('a refused spreadsheet edit raises the writer reason', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { error: 'edit_refused', reason: 'There is no Revenue sheet.' },
      { status: 422 },
    )) as typeof fetch;

  const edit = macro()
    .documents.spreadsheet(macro().documents.byId('doc-1'))
    .edit('Total the Revenue sheet.');

  await expect(edit).rejects.toBeInstanceOf(DocumentEditRefusedError);
  await expect(edit).rejects.toMatchObject({
    reason: 'There is no Revenue sheet.',
  });
});

test('a spreadsheet changed during an edit raises a revision conflict', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { message: 'The spreadsheet changed since it was read.' },
      { status: 409 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.spreadsheet(macro().documents.byId('doc-1'))
      .edit('Add a Summary sheet.'),
  ).rejects.toBeInstanceOf(RevisionConflictError);
});

test('a spreadsheet edit that may have saved has an unknown outcome', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { error: 'edit_failed', message: 'The edit may have been saved.' },
      { status: 502 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.spreadsheet(macro().documents.byId('doc-1'))
      .edit('Add a Summary sheet.'),
  ).rejects.toBeInstanceOf(EditOutcomeUnknownError);
});
