import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const [enabled, setEnabled] = createSignal(true);

vi.mock(
  '@app/features/block-spreadsheet/primitives/use-spreadsheet-access',
  () => ({ useSpreadsheetAccess: () => enabled })
);
vi.mock('@queries/preview', () => ({
  useItemRawName: () => () => 'Renamed budget',
}));
vi.mock(
  '@app/features/block-spreadsheet/components/SpreadsheetSkeleton',
  () => ({
    SpreadsheetSkeleton: () => <div>Opening spreadsheet…</div>,
  })
);
vi.mock('@app/features/block-spreadsheet/views/UploadedWorkbook', () => ({
  UploadedWorkbookFile: (props: {
    documentId: string;
    version: number;
    fileType: string;
    name: string;
  }) => (
    <div>
      Workbook {props.documentId} v{props.version} {props.fileType} {props.name}
    </div>
  ),
}));

import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { DriveUploadedWorkbook } from './DriveUploadedWorkbook';

const metadata = (fileType: string) =>
  ({
    documentId: 'upload',
    documentVersionId: 3,
    documentName: 'Budget',
    fileType,
  }) as DocumentMetadata;

function mount(fileType: string) {
  render(() => (
    <DriveUploadedWorkbook
      documentMetadata={metadata(fileType)}
      fallback={<div>No preview available</div>}
    />
  ));
}

afterEach(() => {
  cleanup();
  setEnabled(true);
});

it.each(['xlsx', 'xlsm', 'csv'])(
  'previews an uploaded %s file as a workbook',
  async (fileType) => {
    mount(fileType);
    expect(
      await screen.findByText(`Workbook upload v3 ${fileType} Renamed budget`)
    ).toBeTruthy();
    expect(screen.queryByText('No preview available')).toBeNull();
  }
);

it('keeps the fallback for other files and while spreadsheets are off', () => {
  mount('zip');
  expect(screen.getByText('No preview available')).toBeTruthy();
  cleanup();
  setEnabled(false);
  mount('xlsx');
  expect(screen.getByText('No preview available')).toBeTruthy();
});
