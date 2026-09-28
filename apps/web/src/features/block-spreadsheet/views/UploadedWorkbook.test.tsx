import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { LoroDoc } from 'loro-crdt';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSpreadsheetWorkbook } from '../core/workbook-document';
import type { SpreadsheetStore } from '../primitives/create-spreadsheet-store';

vi.mock('../spreadsheet-mentions', () => ({ spreadsheetMentions: undefined }));
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  replace: vi.fn(),
  failure: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'original-upload' }));
vi.mock('@core/signal/load', () => ({
  blockMetadataSignal: {
    get: () => ({ documentVersionId: 7, fileType: 'xlsx' }),
  },
}));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => 'Imported budget',
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ handle: { replace: mocks.replace } }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.download }));
vi.mock('../queries/create-spreadsheet', () => ({
  createSpreadsheetDocument: mocks.create,
}));
vi.mock('../queries/save-spreadsheet-draft', () => ({
  saveSpreadsheetDraft: mocks.save,
}));
vi.mock('../primitives/workbook-file-client', () => ({
  importWorkbookFile: vi.fn(),
}));
vi.mock('../queries/uploaded-workbook', () => ({
  uploadedWorkbookQuery: () => ({
    queryKey: ['uploaded-workbook-test'],
    queryFn: mocks.load,
    retry: false,
  }),
}));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('./SpreadsheetEditor', () => ({
  SpreadsheetEditor: (props: { store: SpreadsheetStore }) => (
    <div>
      <span>{props.store.cells().A1?.value}</span>
      <button type="button" disabled={!props.store.canEdit()}>
        Edit cell
      </button>
    </div>
  ),
}));

import UploadedWorkbook from './UploadedWorkbook';

const clients: QueryClient[] = [];
const imported = {
  sheets: [
    {
      name: 'Forecast',
      cells: {
        A1: { value: '=SUM(B1:C1)', numberFormat: '#,##0.00' },
        B1: { value: '12.5' },
        C1: { value: '2.5' },
      },
      rowCount: 200,
      columnWidths: {},
      metadata: {
        merges: ['A2:C2'],
        definedNames: [{ name: 'Rate', formula: '0.1' }],
      },
    },
  ],
  warnings: ['Charts are not imported.'],
};
function mount() {
  const client = new QueryClient();
  clients.push(client);
  return render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div>Outer fallback</div>}>
        <UploadedWorkbook />
      </Suspense>
    </QueryClientProvider>
  ));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(imported);
  mocks.create.mockResolvedValue('native-copy');
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

it('loads without suspending its host, exposes import notes, and preserves all data in the durably saved copy', async () => {
  let finish: (value: typeof imported) => void = () => {};
  mocks.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mount();
  expect(screen.getByText('Opening spreadsheet…')).toBeTruthy();
  expect(screen.queryByText('Outer fallback')).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
  finish(imported);
  await screen.findByText('=SUM(B1:C1)');
  expect(
    screen.getByRole('button', { name: 'Edit cell' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByText('Charts are not imported.')).toBeTruthy();
  let acknowledge = () => {};
  mocks.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit in Macro' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  expect(mocks.replace).not.toHaveBeenCalled();
  const doc = new LoroDoc();
  try {
    doc.import(mocks.save.mock.calls[0][1]);
    const [sheet] = readSpreadsheetWorkbook(doc);
    expect(sheet.cells).toEqual(imported.sheets[0].cells);
    expect(sheet.metadata).toEqual(imported.sheets[0].metadata);
  } finally {
    doc.free();
  }
  expect(mocks.create).toHaveBeenCalledWith({
    title: 'Imported budget',
    source: 'spreadsheet-upload',
  });
  acknowledge();
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'spreadsheet', id: 'native-copy' },
      mergeHistory: true,
      referredFrom: 'entity-actions-menu',
    })
  );
});
it('keeps the source preview and retries the same copy after a failed durable save', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Disconnected'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit in Macro' }));
  await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
  expect(screen.getByText('=SUM(B1:C1)')).toBeTruthy();
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit in Macro' }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
  expect(mocks.create).toHaveBeenCalledOnce();
});
it('shows import failures without offering conversion, and allows retry', async () => {
  mocks.load.mockRejectedValueOnce(new Error('Unsupported workbook'));
  mount();
  await screen.findByText('Unsupported workbook');
  expect(screen.queryByRole('button', { name: 'Edit in Macro' })).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('=SUM(B1:C1)');
});
