import { toaster } from '@kobalte/core/toast';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { followDesktopToastInset } from './desktop-toast-inset';
import { toast } from './Toast';
import { ToastRegion } from './ToastRegion';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/component/UploadProgress/UploadProgressIndicator', () => ({
  UploadProgressIndicator: () => <div>Upload progress</div>,
}));
vi.mock('@app/features/import-jobs/import-jobs', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  toaster.clear();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps toasts and upload progress when the import tray fails to load', async () => {
  render(() => <ToastRegion />);
  toast.success('Saved');

  expect(await screen.findByText('Saved')).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('Upload progress')).toBeTruthy();
});

it('publishes how far the desktop stack reaches up to the controls that follow it, never to the page', () => {
  const observers: { resize: ResizeObserverCallback; target?: Element }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry: { resize: ResizeObserverCallback; target?: Element };
      constructor(resize: ResizeObserverCallback) {
        this.entry = { resize };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      unobserve() {}
      disconnect() {}
    }
  );
  let height = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 380, height }) as DOMRect
  );
  const [showRegion, setShowRegion] = createSignal(true);
  const [showLate, setShowLate] = createSignal(false);
  const inset = (element: HTMLElement) =>
    element.style.getPropertyValue('--desktop-toast-inset-bottom');
  const { unmount } = render(() => (
    <>
      <Show when={showRegion()}>
        <ToastRegion />
      </Show>
      <div data-testid="pill" ref={followDesktopToastInset} />
      <Show when={showLate()}>
        <div data-testid="late" ref={followDesktopToastInset} />
      </Show>
    </>
  ));
  const pill = screen.getByTestId('pill');
  expect(inset(pill)).toBe('0px');

  height = 120;
  for (const { resize, target } of observers) {
    if (target)
      resize(
        [{ target } as ResizeObserverEntry],
        {} as unknown as ResizeObserver
      );
  }
  expect(inset(pill)).toBe('calc(120px + 1.25rem)');
  // Every element inherits a property on the root, so writing it there in
  // each frame of a toast's animation restyled the whole page.
  expect(inset(document.documentElement)).toBe('');

  // A control that appears later starts from the current inset.
  setShowLate(true);
  expect(inset(screen.getByTestId('late'))).toBe('calc(120px + 1.25rem)');

  setShowRegion(false);
  expect(inset(pill)).toBe('');
  unmount();
});
