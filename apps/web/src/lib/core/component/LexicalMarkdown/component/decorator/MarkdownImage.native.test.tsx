/**
 * @vitest-environment jsdom
 */

import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaPlugin = vi.hoisted(() => ({
  $upgradeDSSMediaUrl: vi.fn(),
  getMediaUrl: vi.fn(),
  ON_MEDIA_COMPONENT_MOUNT_COMMAND: 'ON_MEDIA_COMPONENT_MOUNT_COMMAND',
  UPDATE_MEDIA_SIZE_COMMAND: 'UPDATE_MEDIA_SIZE_COMMAND',
  UPLOAD_MEDIA_FAILURE_COMMAND: 'UPLOAD_MEDIA_FAILURE_COMMAND',
  UPLOAD_MEDIA_START_COMMAND: 'UPLOAD_MEDIA_START_COMMAND',
  UPLOAD_MEDIA_SUCCESS_COMMAND: 'UPLOAD_MEDIA_SUCCESS_COMMAND',
}));
const { fetchImage } = vi.hoisted(() => ({ fetchImage: vi.fn() }));
vi.mock('../../plugins/media', () => mediaPlugin);
vi.mock('../../plugins', () => mediaPlugin);
vi.mock('@core/component/Lightbox', () => ({ Lightbox: () => null }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
// The desktop and mobile apps: the session lives in the native HTTP client's
// cookie jar, which only platformFetch can use.
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isTauri: () => true,
}));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: fetchImage }));

import { displayImageUrl } from '@core/util/imageProxy';
import { MarkdownImage } from './MarkdownImage';

const SCREENSHOT =
  'https://github.com/macro-inc/macro/raw/e619def1da7ee815b83d68dd676273e23b3eb5a2/11420/before.png';

const unsetMedia = {
  srcType: 'url',
  id: '',
  width: 0,
  height: 0,
  scale: 1,
} as const;

function imageResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      'content-type': status === 200 ? 'image/png' : 'application/json',
    }),
    blob: async () => new Blob(['png'], { type: 'image/png' }),
  };
}

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

describe('markdown images in the native apps', () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    let next = 0;
    URL.createObjectURL = () => {
      const url = `blob:test/${++next}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    fetchImage.mockReset();
  });

  it('fetches a proxied screenshot with the native session and shows it from a blob', async () => {
    fetchImage.mockResolvedValue(imageResponse());
    const view = render(() => (
      <MarkdownImage {...unsetMedia} key="shot" url={SCREENSHOT} alt="Before" />
    ));
    const image = view.container.querySelector('img')!;

    // Never hands the proxy URL to the webview's own loader, which has no
    // session and gets 401.
    expect(image.getAttribute('src')).toBe('');
    await waitFor(() => expect(image.getAttribute('src')).toBe('blob:test/1'));
    expect(fetchImage).toHaveBeenCalledWith(
      displayImageUrl(SCREENSHOT),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(image.crossOrigin).toBe('anonymous');

    view.unmount();
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('shows the broken-image state when the proxy refuses the image', async () => {
    fetchImage.mockResolvedValue(imageResponse(401));
    const view = render(() => (
      <MarkdownImage {...unsetMedia} key="shot" url={SCREENSHOT} alt="Before" />
    ));
    await waitFor(() =>
      expect(view.getByText('This image could not be found.')).toBeTruthy()
    );
    expect(created).toEqual([]);
  });

  it('loads public CORS media directly, without a native fetch', () => {
    const src = 'https://static.klipy.com/media/example/medium.gif';
    const view = render(() => (
      <MarkdownImage {...unsetMedia} key="gif" url={src} alt="GIF" />
    ));
    expect(view.container.querySelector('img')!.getAttribute('src')).toBe(src);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('drops a superseded fetch when the image changes', async () => {
    const first = Promise.withResolvers<ReturnType<typeof imageResponse>>();
    fetchImage
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(imageResponse());
    const [url, setUrl] = createSignal(SCREENSHOT);
    const view = render(() => (
      <MarkdownImage {...unsetMedia} key="shot" url={url()} alt="Shot" />
    ));
    const image = view.container.querySelector('img')!;

    setUrl(SCREENSHOT.replace('before', 'after'));
    await waitFor(() => expect(image.getAttribute('src')).toBe('blob:test/1'));
    expect(fetchImage.mock.calls[0]![1].signal.aborted).toBe(true);

    first.resolve(imageResponse());
    // Let the superseded fetch run to completion before checking it was dropped.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toEqual(['blob:test/1']);
    expect(image.getAttribute('src')).toBe('blob:test/1');
  });
});
