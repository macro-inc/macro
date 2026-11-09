/** @vitest-environment jsdom */
import { BackgroundCameraPreview } from '@core/component/media/background-camera-preview';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  init: vi.fn<(name: string) => Promise<void>>(),
  destroy: vi.fn(),
}));
vi.mock('@livekit/track-processors', () => ({
  supportsBackgroundProcessors: () => true,
  BackgroundProcessor: () => {
    const processor = {
      name: '',
      init: () => state.init(processor.name),
      destroy: state.destroy,
      processedTrack: {},
    };
    return processor;
  },
}));
vi.mock('livekit-client', () => ({ Track: { Kind: { Video: 'video' } } }));
beforeEach(() => {
  vi.clearAllMocks();
  state.init.mockResolvedValue(undefined);
  state.destroy.mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('MediaStream', class {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function source() {
  const clone = { stop: vi.fn() };
  const original = Object.assign(new EventTarget(), {
    readyState: 'live',
    stop: vi.fn(),
    clone: () => clone,
  });
  return { original: original as unknown as MediaStreamTrack, clone };
}

it('releases preview resources without stopping the published camera', async () => {
  const { original, clone } = source();
  const view = render(() => (
    <BackgroundCameraPreview track={original} blur="light" />
  ));
  await waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  view.unmount();
  await waitFor(() => expect(state.destroy).toHaveBeenCalledOnce());
  expect(clone.stop).toHaveBeenCalledOnce();
  expect(original.stop).not.toHaveBeenCalled();
});

it('waits for pending initialization before destroying a closed preview', async () => {
  let finish!: () => void;
  state.init.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const { original, clone } = source();
  const view = render(() => (
    <BackgroundCameraPreview track={original} blur="heavy" />
  ));
  await waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  view.unmount();
  expect(state.destroy).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(state.destroy).toHaveBeenCalledOnce());
  expect(clone.stop).toHaveBeenCalledOnce();
});

it('clears the preview when camera capture ends', async () => {
  const { original, clone } = source();
  const [track, setTrack] = createSignal<MediaStreamTrack | undefined>(
    original
  );
  const view = render(() => <BackgroundCameraPreview track={track()} />);
  await waitFor(() =>
    expect(
      view.container.querySelector('video')?.classList.contains('invisible')
    ).toBe(false)
  );
  setTrack(undefined);
  expect(clone.stop).toHaveBeenCalledOnce();
  expect(
    view.container.querySelector('video')?.classList.contains('invisible')
  ).toBe(true);
});

it('gives concurrent processors distinct fallback canvas names', async () => {
  const { original } = source();
  const view = render(() => (
    <BackgroundCameraPreview track={original} blur="light" />
  ));
  await waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  const other = render(() => (
    <BackgroundCameraPreview track={original} blur="heavy" />
  ));
  await waitFor(() => expect(state.init).toHaveBeenCalledTimes(2));
  expect(new Set(state.init.mock.calls.map(([name]) => name)).size).toBe(2);
  view.unmount();
  other.unmount();
  await waitFor(() => expect(state.destroy).toHaveBeenCalledTimes(2));
});
