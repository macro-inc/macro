import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGoToLinkLocation } from './location';

const state = vi.hoisted(() => ({
  persistedViewLocation: (): string | undefined => undefined,
  ready: (): boolean => false,
  goToLocationHash: vi.fn(),
}));

vi.mock('../context/pdf-document-context', () => ({
  usePdfDocument: () => ({
    persistedViewLocation: () => state.persistedViewLocation(),
  }),
}));
vi.mock('../context/pdf-viewer-context', () => ({
  usePdfViewer: () => ({
    root: {
      isReady: () => state.ready(),
      hasVisiblePages: () => state.ready(),
      instance: () => ({ goToLocationHash: state.goToLocationHash }),
      findControlState: () => undefined,
    },
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

function setup(persistedViewLocation?: string) {
  const [ready, setReady] = createSignal(false);
  state.persistedViewLocation = () => persistedViewLocation;
  state.ready = ready;
  const goToLinkLocation = createRoot(() => useGoToLinkLocation());
  return { goToLinkLocation, setReady };
}

it('settles without restoring when the PDF has no saved location', async () => {
  const { goToLinkLocation } = setup();
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(5000);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).not.toHaveBeenCalled();
});

it('restores the saved location once the viewer shows pages', async () => {
  const { goToLinkLocation, setReady } = setup('#page=4');
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(1000);
  setReady(true);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).toHaveBeenCalledExactlyOnceWith('#page=4');
});

it('settles without restoring when the viewer never shows pages', async () => {
  const { goToLinkLocation } = setup('#page=4');
  const navigation = goToLinkLocation({});
  await vi.advanceTimersByTimeAsync(5000);
  await expect(navigation).resolves.toBeUndefined();
  expect(state.goToLocationHash).not.toHaveBeenCalled();
});
