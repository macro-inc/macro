import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MediaGrid } from './MediaGrid';
import type { MediaItem } from './media-items';

const isTouchDevice = vi.hoisted(() => vi.fn(() => false));
const imageActions = vi.hoisted(() => ({
  copyImageToClipboard: vi.fn(
    async (
      _getBlob: () => Promise<Blob | undefined>,
      _fallbackUrl: string
    ) => {}
  ),
  downloadImage: vi.fn(
    async (_getBlob: () => Promise<Blob | undefined>, _imageId: string) => {}
  ),
}));

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice }));
vi.mock('@core/util/imageActions', () => imageActions);
vi.mock('@core/util/platformFetch', () => ({
  platformFetch: async () => new Response(new Blob()),
}));

const imageItem: MediaItem = {
  id: 'img-1',
  src: 'https://example.test/medium/img-1',
  fullSrc: 'https://example.test/full/img-1',
  kind: 'image',
  width: 800,
  height: 600,
};

beforeEach(() => {
  isTouchDevice.mockReturnValue(false);
  imageActions.copyImageToClipboard.mockClear();
  imageActions.downloadImage.mockClear();
});
afterEach(cleanup);

it('offers copy and download on an inline message image', async () => {
  render(() => (
    <MediaGrid items={[imageItem]} variant="message" onOpen={() => {}} />
  ));

  await userEvent.click(screen.getByRole('button', { name: 'Copy image' }));
  expect(imageActions.copyImageToClipboard).toHaveBeenCalledOnce();

  await userEvent.click(screen.getByRole('button', { name: 'Download image' }));
  expect(imageActions.downloadImage.mock.calls[0]?.[1]).toBe('img-1');
});

it('keeps the image itself clickable alongside the hover actions', async () => {
  const onOpen = vi.fn();
  render(() => (
    <MediaGrid items={[imageItem]} variant="message" onOpen={onOpen} />
  ));

  await userEvent.click(
    screen.getByRole('button', { name: 'Open image viewer' })
  );
  expect(onOpen).toHaveBeenCalledWith(0);
});

it('omits the hover actions on touch devices, where the viewer provides them', () => {
  isTouchDevice.mockReturnValue(true);
  render(() => (
    <MediaGrid items={[imageItem]} variant="message" onOpen={() => {}} />
  ));

  expect(screen.queryByRole('button', { name: 'Copy image' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download image' })).toBeNull();
});
