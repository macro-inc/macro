/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { CallRecordingVideo } from './CallRecordingVideo';

const recordingUrl =
  'https://recordings.example/calls/call-1.mp4?signature=abc';
const nextRecordingUrl =
  'https://recordings.example/calls/call-2.mp4?signature=def';
const posterUrl =
  'https://recordings.example/previews/call-1.jpg?signature=abc';
const posterBlobUrl = 'blob:call-recording-preview';

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  'createObjectURL'
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  'revokeObjectURL'
);

function restoreUrlMethod(
  name: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
    return;
  }

  Reflect.deleteProperty(URL, name);
}

function mockPosterFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      blob: async () => new Blob(['poster'], { type: 'image/jpeg' }),
      ok: true,
    }))
  );
}

function getVideo(container: HTMLElement): HTMLVideoElement {
  const video = container.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) {
    throw new Error('Expected call recording video element');
  }

  return video;
}

function dispatchMediaError(video: HTMLVideoElement, code: number): void {
  Object.defineProperty(video, 'error', {
    configurable: true,
    value: { code },
  });
  video.dispatchEvent(new Event('error'));
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => posterBlobUrl),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  restoreUrlMethod('createObjectURL', originalCreateObjectUrl);
  restoreUrlMethod('revokeObjectURL', originalRevokeObjectUrl);
});

describe('CallRecordingVideo', () => {
  it.each([2, 3, 4])(
    'shows a playback fallback for media error %s while preserving native video attributes',
    async (code) => {
      mockPosterFetch();

      const { container } = render(() => (
        <CallRecordingVideo url={recordingUrl} posterUrl={posterUrl} />
      ));
      const video = getVideo(container);

      expect(video.load).toHaveBeenCalledOnce();

      await waitFor(() =>
        expect(video.getAttribute('poster')).toBe(posterBlobUrl)
      );

      dispatchMediaError(video, code);

      expect(
        screen.getByText("This recording couldn't be played.")
      ).not.toBeNull();

      const fallbackLink = screen.getByRole('link', {
        name: 'Open or download recording',
      });
      expect(fallbackLink.getAttribute('href')).toBe(recordingUrl);
      expect(fallbackLink.getAttribute('target')).toBe('_blank');
      expect(fallbackLink.getAttribute('rel')).toBe('noopener noreferrer');
      expect(fallbackLink.hasAttribute('download')).toBe(true);

      expect(video.hasAttribute('controls')).toBe(true);
      expect(video.getAttribute('preload')).toBe('metadata');
      expect(video.getAttribute('crossorigin')).toBe('anonymous');
      expect(video.getAttribute('poster')).toBe(posterBlobUrl);
      expect(video.getAttribute('src')).toBe(recordingUrl);

      video.dispatchEvent(new Event('canplay'));

      expect(screen.queryByRole('alert')).toBeNull();
    }
  );

  it('clears the fallback when the recording URL changes', async () => {
    const [url, setUrl] = createSignal(recordingUrl);
    const { container } = render(() => <CallRecordingVideo url={url()} />);
    const video = getVideo(container);

    dispatchMediaError(video, 4);
    expect(screen.getByRole('alert')).not.toBeNull();

    setUrl(nextRecordingUrl);

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(video.getAttribute('src')).toBe(nextRecordingUrl);
  });
});
