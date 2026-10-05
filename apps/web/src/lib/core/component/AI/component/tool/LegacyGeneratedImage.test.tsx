import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyGeneratedImage } from './LegacyGeneratedImage';

vi.mock('@core/component/ImageDocumentCard', () => ({
  ImageDocumentCard: (props: { documentId: string; fileName: string }) => (
    <div data-testid="document-image" data-document-id={props.documentId}>
      {props.fileName}
    </div>
  ),
}));

afterEach(cleanup);

const historicalResult = {
  documentId: 'old-image-id',
  fileName: 'lighthouse.png',
  mimeType: 'image/png',
  sizeBytes: 100,
  note: 'A calm scene.',
};

describe('historical generated images', () => {
  it('renders the saved document and note without mounting the new result renderer', () => {
    const fallback = vi.fn(() => <div>Current renderer</div>);
    const view = render(() => (
      <LegacyGeneratedImage name="GenerateImage" response={historicalResult}>
        {fallback()}
      </LegacyGeneratedImage>
    ));
    expect(view.getByTestId('document-image').dataset.documentId).toBe(
      'old-image-id'
    );
    expect(view.getByText('lighthouse.png')).toBeTruthy();
    expect(view.getByText('A calm scene.')).toBeTruthy();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    [
      'GenerateImage',
      {
        staticFileId: 'new-image-id',
        url: 'https://static.example/file/new-image-id',
      },
    ],
    ['GenerateImage', undefined],
    ['GenerateImage', { documentId: 'id' }],
    ['GenerateImage', { documentId: '', fileName: 'invalid' }],
    ['CreateDocument', historicalResult],
  ])(
    'leaves %s responses that are not historical images to the current renderer',
    (name, response) => {
      const view = render(() => (
        <LegacyGeneratedImage name={name} response={response}>
          <div>Current renderer</div>
        </LegacyGeneratedImage>
      ));
      expect(view.getByText('Current renderer')).toBeTruthy();
      expect(view.queryByTestId('document-image')).toBeNull();
    }
  );

  it('recognizes a historical result when it arrives after the call', () => {
    const [response, setResponse] = createSignal<unknown>();
    const view = render(() => (
      <LegacyGeneratedImage name="GenerateImage" response={response()}>
        <div>Current renderer</div>
      </LegacyGeneratedImage>
    ));
    expect(view.getByText('Current renderer')).toBeTruthy();
    setResponse(historicalResult);
    expect(view.getByTestId('document-image')).toBeTruthy();
    expect(view.queryByText('Current renderer')).toBeNull();
  });
});
