import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmailAttachmentOpener } from './attachment-action-adapter';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  getDocument: vi.fn(),
  getMetadata: vi.fn(),
  getDownloadUrl: vi.fn(),
  downloadFile: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@queries/email/integration', () => ({
  getEmailAttachmentDocument: mocks.getDocument,
  getEmailAttachmentMetadata: mocks.getMetadata,
}));
vi.mock('@queries/email/attachment', () => ({
  getEmailAttachmentDownloadUrl: mocks.getDownloadUrl,
}));
vi.mock('@queries/soup/cache', () => ({
  refetchSoupEntity: () => Promise.resolve(),
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.downloadFile }));

beforeEach(() => {
  mocks.getDocument.mockResolvedValue(
    ok({ attachment_id: 'pdf', document_id: 'document' })
  );
  mocks.getMetadata.mockResolvedValue(ok({}));
  mocks.getDownloadUrl.mockResolvedValue('https://files.example.com/signed');
  mocks.downloadFile.mockResolvedValue({ saved: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('BEGIN:VCALENDAR', { status: 200 }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const opener = () => createRoot(() => createEmailAttachmentOpener());

it('saves a calendar file without filing it into Drive', async () => {
  await opener()({
    db_id: 'ics',
    filename: 'Planning.ics',
    mime_type: 'text/calendar',
  });

  expect(mocks.getDocument).not.toHaveBeenCalled();
  expect(mocks.openWithSplit).not.toHaveBeenCalled();
  expect(mocks.getDownloadUrl).toHaveBeenCalledWith('ics');
  expect(mocks.downloadFile).toHaveBeenCalledWith(
    expect.any(Blob),
    'Planning.ics'
  );
});

it('opens a previewable file in its viewer', async () => {
  await opener()({
    db_id: 'pdf',
    filename: 'Agenda.pdf',
    mime_type: 'application/pdf',
  });

  expect(mocks.getDocument).toHaveBeenCalledWith('pdf');
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'pdf', id: 'document' },
    { preferNewSplit: true }
  );
  expect(mocks.downloadFile).not.toHaveBeenCalled();
});

it('keeps opening other files from their Drive copy, which previews workbooks', async () => {
  await opener()({
    db_id: 'xlsx',
    filename: 'Budget.xlsx',
    mime_type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  expect(mocks.getDocument).toHaveBeenCalledWith('xlsx');
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'unknown', id: 'document' },
    { preferNewSplit: true }
  );
  expect(mocks.downloadFile).not.toHaveBeenCalled();
});
