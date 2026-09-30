import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateImageHandler } from './GenerateImage';
import { ToolErrorContext } from './ToolRenderer';

const preview = vi.hoisted(() => ({
  isSuccess: true,
  isError: false,
  url: 'https://storage.example/frog.png',
  dataReads: 0,
}));

vi.mock('@queries/storage/binary-document', () => ({
  useBinaryDocumentQuery: () => ({
    get isSuccess() {
      return preview.isSuccess;
    },
    get isError() {
      return preview.isError;
    },
    get data() {
      preview.dataReads += 1;
      if (!preview.isSuccess) throw new Error('Pending data read');
      return preview.url;
    },
  }),
}));

const splits = vi.hoisted(() => ({
  activate: vi.fn(),
  insertSplit: vi.fn(),
  replaceOrInsertSplit: vi.fn(),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => splits,
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

const result = {
  documentId: 'image-id',
  fileName: 'frog.png',
  mimeType: 'image/png',
  sizeBytes: 132421,
  note: 'A frog under a leaf.',
};

function imageTool(
  response = true,
  error?: string | (() => string | undefined)
) {
  const failure = () => (typeof error === 'function' ? error() : error);
  return render(() => (
    <ToolErrorContext.Provider value={failure}>
      <generateImageHandler.render
        tool={{
          id: 'call-1',
          name: 'GenerateImage',
          data: { prompt: 'A frog under a leaf', fileName: 'frog' },
        }}
        response={
          response
            ? { id: 'call-1', name: 'GenerateImage', data: result }
            : undefined
        }
        chat_id="chat-1"
        message_id="message-1"
        part_index={0}
        isComplete={response || !!failure()}
        renderContext={{ isStreaming: !response, grouped: false }}
      />
    </ToolErrorContext.Provider>
  ));
}

afterEach(cleanup);
beforeEach(() => {
  preview.isSuccess = true;
  preview.isError = false;
  preview.dataReads = 0;
  splits.activate.mockClear();
  splits.insertSplit.mockReset().mockReturnValue({ activate: splits.activate });
  splits.replaceOrInsertSplit
    .mockReset()
    .mockReturnValue({ activate: splits.activate });
});

describe('generated image result', () => {
  it('shows the filename and image as one card that opens and activates a new app split', () => {
    const view = imageTool();
    const card = view.getByRole('button', {
      name: 'Open frog.png in a new split',
    });
    expect(card.getAttribute('type')).toBe('button');
    expect(card.textContent).toBe('frog.png');
    fireEvent.click(card);
    expect(splits.insertSplit).toHaveBeenCalledExactlyOnceWith({
      type: 'image',
      id: 'image-id',
    });
    expect(splits.activate).toHaveBeenCalledOnce();
    expect(splits.replaceOrInsertSplit).not.toHaveBeenCalled();
    expect(
      view.getByRole('img', { name: 'frog.png' }).getAttribute('src')
    ).toBe(preview.url);
    expect(view.getByText(result.note)).toBeTruthy();
    expect(view.queryByText('Generate image')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
  });

  it('keeps the file card while the upload is pending without reading query data', () => {
    preview.isSuccess = false;
    const view = imageTool();
    expect(view.getByText('Preparing preview')).toBeTruthy();
    expect(view.getByRole('button')).toBeTruthy();
    expect(preview.dataReads).toBe(0);
  });

  it('keeps the file card when the preview query fails', () => {
    preview.isSuccess = false;
    preview.isError = true;
    const view = imageTool();
    expect(view.getByText('Preview unavailable')).toBeTruthy();
    expect(view.getByRole('button')).toBeTruthy();
    expect(preview.dataReads).toBe(0);
  });

  it('replaces a failed image load with an inline status', () => {
    const view = imageTool();
    fireEvent.error(view.getByRole('img'));
    expect(view.getByText('Preview unavailable')).toBeTruthy();
    expect(view.queryByRole('img')).toBeNull();
    expect(view.getByRole('button')).toBeTruthy();
  });

  it('shows the requested filename while generation is pending', () => {
    const view = imageTool(false);
    expect(view.getByText('frog')).toBeTruthy();
    expect(view.getByText('Generating image')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('replaces a pending generation with its failure state', () => {
    const [error, setError] = createSignal<string>();
    const view = imageTool(false, error);
    expect(view.getByText('Generating image')).toBeTruthy();
    setError('failed');
    expect(view.getByText('Image generation failed')).toBeTruthy();
    expect(view.queryByText('Generating image')).toBeNull();
  });

  it('shows a failed generation without a document button', () => {
    const view = imageTool(false, 'failed');
    expect(view.getByText('Image generation failed')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByText('Generating image')).toBeNull();
  });
});
