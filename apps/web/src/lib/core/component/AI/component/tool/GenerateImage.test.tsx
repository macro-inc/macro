import type { GenerateImageResponse } from '@service-cognition/generated/tools/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { generateImageHandler } from './GenerateImage';
import { ToolErrorContext } from './ToolRenderer';

const result = {
  staticFileId: 'image-id',
  url: 'https://static.example/file/image-id',
  mimeType: 'image/png',
  sizeBytes: 132421,
  note: 'A frog under a leaf.',
  width: 1536,
  height: 1024,
};

function imageTool(
  response = true,
  error?: string | (() => string | undefined),
  data: GenerateImageResponse = result
) {
  const failure = () => (typeof error === 'function' ? error() : error);
  return render(() => (
    <ToolErrorContext.Provider value={failure}>
      <generateImageHandler.render
        tool={{
          id: 'call-1',
          name: 'GenerateImage',
          data: { prompt: 'A frog under a leaf' },
        }}
        response={
          response ? { id: 'call-1', name: 'GenerateImage', data } : undefined
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
describe('generated image result', () => {
  it('renders the SFS URL directly without a document card or filename', () => {
    const view = imageTool();
    expect(
      view.getByRole('img', { name: 'Generated image' }).getAttribute('src')
    ).toBe(result.url);
    expect(view.queryByRole('button')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
    expect(view.queryByText(result.note)).toBeNull();
    expect(view.container.textContent).toBe('');
  });

  it('replaces a failed image load with an inline status', () => {
    const view = imageTool();
    fireEvent.error(view.getByRole('img'));
    expect(view.getByText('Preview unavailable')).toBeTruthy();
    expect(view.queryByRole('img')).toBeNull();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('reserves the same responsive box before load and after a load failure', () => {
    const view = imageTool();
    const image = view.getByRole('img');
    const frame = image.parentElement!;
    expect(image.getAttribute('width')).toBe('576');
    expect(image.getAttribute('height')).toBe('384');
    expect(frame.style.width).toBe('576px');
    expect(frame.style.aspectRatio).toBe('576 / 384');
    const style = frame.getAttribute('style');
    fireEvent.load(image);
    expect(frame.getAttribute('style')).toBe(style);
    fireEvent.error(image);
    expect(frame.getAttribute('style')).toBe(style);
    expect(view.getByText('Preview unavailable')).toBeTruthy();
  });

  it('still renders historical results without dimensions', () => {
    const { width: _, height: __, ...historical } = result;
    const view = imageTool(true, undefined, historical);
    expect(view.getByRole('img').getAttribute('src')).toBe(result.url);
    expect(view.getByRole('img').hasAttribute('width')).toBe(false);
  });

  it('shows a status while generation is pending', () => {
    const view = imageTool(false);
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
