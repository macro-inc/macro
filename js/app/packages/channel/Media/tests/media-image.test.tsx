/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { MediaImage } from '../MediaImage';

vi.mock(
  '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid',
  () => ({
    default: () => <span data-testid="spinner-icon" />,
  })
);

describe('MediaImage', () => {
  it('keeps rendering a local preview when the primary source fails', () => {
    render(() => (
      <MediaImage.Image
        src="https://static.example/file/image-id?size=1080"
        previewSrc="blob:local-preview"
        fallback={<MediaImage.Fallback square />}
      />
    ));

    const images = screen.getAllByAltText('preview') as HTMLImageElement[];
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      'blob:local-preview',
      'https://static.example/file/image-id?size=1080',
    ]);

    images[1]?.dispatchEvent(new Event('error'));

    expect(
      (screen.getAllByAltText('preview') as HTMLImageElement[]).map((image) =>
        image.getAttribute('src')
      )
    ).toEqual([
      'blob:local-preview',
      'https://static.example/file/image-id?size=1080',
    ]);
  });
});
