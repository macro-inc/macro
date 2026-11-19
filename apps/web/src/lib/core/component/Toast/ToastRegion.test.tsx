import { toaster } from '@kobalte/core/toast';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

it('publishes how far the desktop stack reaches up while it shows something', () => {
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
  const inset = () =>
    document.documentElement.style.getPropertyValue(
      '--desktop-toast-inset-bottom'
    );
  const { unmount } = render(() => <ToastRegion />);
  expect(inset()).toBe('0px');

  height = 120;
  for (const { resize, target } of observers) {
    if (target)
      resize(
        [{ target } as ResizeObserverEntry],
        {} as unknown as ResizeObserver
      );
  }
  expect(inset()).toBe('calc(120px + 1.25rem)');

  unmount();
  expect(inset()).toBe('');
});
