import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformFetch = vi.hoisted(() => vi.fn());
const copyImageToClipboard = vi.hoisted(() => vi.fn());
vi.mock('@core/util/platformFetch', () => ({ platformFetch }));
vi.mock('@core/util/imageActions', () => ({
  copyImageToClipboard,
  downloadImage: vi.fn(),
}));

import { proxyImageUrl } from '@core/util/imageProxy';
import { createImageActions } from './createImageActions';

async function copyAndFetch(src: string) {
  const actions = createRoot(() =>
    createImageActions({ src: () => src, imageId: () => 'image' })
  );
  await actions.copyToClipboard();
  const [getBlob] = copyImageToClipboard.mock.calls[0]!;
  await getBlob();
}

describe('createImageActions', () => {
  beforeEach(() => {
    platformFetch.mockReset();
    platformFetch.mockResolvedValue(new Response(new Blob(['gif'])));
    copyImageToClipboard.mockReset();
  });

  it('fetches a proxied image with the session cookie', async () => {
    const src = proxyImageUrl('https://example.com/shot.gif');
    await copyAndFetch(src);
    expect(platformFetch).toHaveBeenCalledWith(src, {
      credentials: 'include',
    });
  });

  it('fetches any other image without credentials', async () => {
    const src = 'https://example.com/shot.gif';
    await copyAndFetch(src);
    expect(platformFetch).toHaveBeenCalledWith(src, undefined);
  });
});
