import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeAppUpdateRequiredDialog } from './NativeAppUpdateRequiredDialog';
import { openNativeUpdateLink } from './native-update-link';

vi.mock('@core/util/platform', () => ({
  getNativeMobilePlatform: () => 'android',
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('./native-update-link', () => ({ openNativeUpdateLink: vi.fn() }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Surface')),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps a mobile drawer dismissible after an unavailable store', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.mocked(openNativeUpdateLink).mockResolvedValue(false);
  const close = vi.fn();
  render(() => {
    const [open, setOpen] = createSignal(true);
    return (
      <NativeAppUpdateRequiredDialog
        open={open()}
        onClose={() => {
          close();
          setOpen(false);
        }}
      />
    );
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Update app' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Unable to open')
  );
  expect(openNativeUpdateLink).toHaveBeenCalledWith('android');
  await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(close).toHaveBeenCalledOnce();
});
