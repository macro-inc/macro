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
});

it('keeps toasts and upload progress when the import tray fails to load', async () => {
  render(() => <ToastRegion />);
  toast.success('Saved');

  expect(await screen.findByText('Saved')).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('Upload progress')).toBeTruthy();
});
