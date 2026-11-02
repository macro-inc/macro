import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFileDocumentUrl: vi.fn(),
  fetchPresignedBlobWithProgress: vi.fn(),
}));

vi.mock('@queries/storage/file-document', () => ({
  getFileDocumentUrl: mocks.getFileDocumentUrl,
}));

vi.mock('@service-storage/util/fetchPresigned', () => ({
  fetchPresignedBlobWithProgress: mocks.fetchPresignedBlobWithProgress,
}));

import { TEXT_PREVIEW_MAX_BYTES } from '../core/text-preview';
import { UnknownFilePreview } from './UnknownFilePreview';

/** jsdom's Blob has no arrayBuffer(). */
function fileBlob(bytes: Uint8Array) {
  return { size: bytes.length, arrayBuffer: async () => bytes.buffer };
}

function renderPreview(fileType: string | null, client = new QueryClient()) {
  return render(() => (
    <QueryClientProvider client={client}>
      <UnknownFilePreview
        file={{ documentId: 'doc', documentVersionId: 7, fileType }}
        fileName="qa-test-attach"
        onShare={vi.fn()}
        onDownload={vi.fn()}
      />
    </QueryClientProvider>
  ));
}

// The static renderer is a slow chunk to load, so the lazy view resolves at once.
beforeAll(() => import('./UnknownTextContent'), 60_000);

beforeEach(() => {
  mocks.getFileDocumentUrl.mockResolvedValue('https://files.test/doc');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows a text file literally, never as Markdown', async () => {
  mocks.fetchPresignedBlobWithProgress.mockResolvedValue(
    ok(
      fileBlob(new TextEncoder().encode('# Not a heading\n\n  **indented**\n'))
    )
  );

  const { container } = renderPreview(null);

  await waitFor(() => screen.getByText('# Not a heading'));
  expect(container.textContent).toContain('  **indented**');
  expect(container.querySelectorAll('p')).toHaveLength(1);
  expect(container.querySelector('h1')).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
  expect(screen.queryByText(/No preview available/)).toBeNull();
  expect(mocks.fetchPresignedBlobWithProgress).toHaveBeenCalledWith(
    'https://files.test/doc',
    expect.any(Function),
    expect.anything(),
    TEXT_PREVIEW_MAX_BYTES
  );
});

it('offers the file when its bytes are not text', async () => {
  mocks.fetchPresignedBlobWithProgress.mockResolvedValue(
    ok(fileBlob(new Uint8Array([0x00, 0x01, 0x02])))
  );

  renderPreview(null);

  await waitFor(() => screen.getByText(/No preview available/));
  expect(screen.getByText('Download')).toBeTruthy();
});

it('offers the file when it is empty', async () => {
  mocks.fetchPresignedBlobWithProgress.mockResolvedValue(
    ok(fileBlob(new Uint8Array()))
  );

  renderPreview(null);

  await waitFor(() => screen.getByText(/No preview available/));
});

it('offers the file when it is too large or the download fails', async () => {
  mocks.fetchPresignedBlobWithProgress.mockResolvedValue(
    err([{ code: 'UNKNOWN_ERROR', message: 'File exceeds the limit.' }])
  );

  renderPreview(null);

  await waitFor(() => screen.getByText(/No preview available/));
});

it('offers the file when its download link fails', async () => {
  mocks.getFileDocumentUrl.mockRejectedValue(new Error('no location'));

  renderPreview(null);

  await waitFor(() => screen.getByText(/No preview available/));
});

it('tries again when a file that failed to load is opened again', async () => {
  const client = new QueryClient();
  mocks.getFileDocumentUrl.mockRejectedValueOnce(new Error('offline'));
  mocks.fetchPresignedBlobWithProgress.mockResolvedValue(
    ok(fileBlob(new TextEncoder().encode('back online\n')))
  );

  const firstOpen = renderPreview(null, client);
  await waitFor(() => screen.getByText(/No preview available/));
  firstOpen.unmount();

  renderPreview(null, client);
  await waitFor(() => screen.getByText('back online'));
});

it('never downloads a known binary type', async () => {
  renderPreview('zip');

  await waitFor(() => screen.getByText(/No preview available/));
  expect(mocks.fetchPresignedBlobWithProgress).not.toHaveBeenCalled();
});
