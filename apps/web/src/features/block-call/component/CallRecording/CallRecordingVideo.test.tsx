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
const mediaErrSrcNotSupported = 4;

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

function dispatchUnsupportedMediaError(video: HTMLVideoElement): void {
  Object.defineProperty(video, 'error', {
    configurable: true,
    value: { code: mediaErrSrcNotSupported },
  });
  video.dispatchEvent(new Event('error'));
}

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

afterAll(() => {
  restoreUrlMethod('createObjectURL', originalCreateObjectUrl);
  restoreUrlMethod('revokeObjectURL', originalRevokeObjectUrl);
});

describe('CallRecordingVideo', () => {
  it('shows an unsupported-format fallback while preserving native video attributes', async () => {
    mockPosterFetch();

    const { container } = render(() => (
      <CallRecordingVideo url={recordingUrl} posterUrl={posterUrl} />
    ));
    const video = getVideo(container);

    await waitFor(() =>
      expect(video.getAttribute('poster')).toBe(posterBlobUrl)
    );

    dispatchUnsupportedMediaError(video);

    expect(
      screen.getByText(
        "This recording uses a media format your browser can't play."
      )
    ).not.toBeNull();

    const fallbackLink = screen.getByRole('link', {
      name: 'Open or download recording',
    });
    expect(fallbackLink.getAttribute('href')).toBe(recordingUrl);
    expect(fallbackLink.getAttribute('target')).toBe('_blank');
    expect(fallbackLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(fallbackLink.hasAttribute('download')).toBe(true);

    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('crossorigin')).toBe('anonymous');
    expect(video.getAttribute('poster')).toBe(posterBlobUrl);
    expect(video.getAttribute('src')).toBe(recordingUrl);

    video.dispatchEvent(new Event('canplay'));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the fallback when the recording URL changes', async () => {
    const [url, setUrl] = createSignal(recordingUrl);
    const { container } = render(() => <CallRecordingVideo url={url()} />);
    const video = getVideo(container);

    dispatchUnsupportedMediaError(video);
    expect(screen.getByRole('alert')).not.toBeNull();

    setUrl(nextRecordingUrl);

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(video.getAttribute('src')).toBe(nextRecordingUrl);
  });
});
