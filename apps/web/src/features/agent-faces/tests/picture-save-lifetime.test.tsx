import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uploadAgentPicture } from '../primitives/upload-agent-picture';
import { ChangePictureDialog } from '../views/change-picture-dialog';

vi.mock('../primitives/upload-agent-picture', () => ({
  uploadAgentPicture: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('does not save after its upload finishes on a disposed dialog', async () => {
  const upload =
    Promise.withResolvers<Awaited<ReturnType<typeof uploadAgentPicture>>>();
  vi.mocked(uploadAgentPicture).mockReturnValueOnce(upload.promise);
  const onSave = vi.fn().mockResolvedValue(true);
  const onOpenChange = vi.fn();
  const view = render(() => (
    <ChangePictureDialog
      open
      name="Ada"
      initials="A"
      face={{ v: 1, seed: 'example', pins: {} }}
      onSave={onSave}
      onOpenChange={onOpenChange}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(
    screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')
  ).toBe('true');
  view.unmount();
  upload.resolve(ok({ face: { v: 1, seed: 'example', pins: {} }, url: null }));
  await upload.promise;
  expect(onSave).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('does not close a replacement dialog when a prior save finishes', async () => {
  vi.mocked(uploadAgentPicture).mockResolvedValueOnce(
    ok({ face: { v: 1, seed: 'example', pins: {} }, url: null })
  );
  const saving = Promise.withResolvers<boolean>();
  const started = Promise.withResolvers<void>();
  const onSave = vi.fn(() => {
    started.resolve();
    return saving.promise;
  });
  const onOpenChange = vi.fn();
  const view = render(() => (
    <ChangePictureDialog
      open
      name="Ada"
      initials="A"
      face={{ v: 1, seed: 'example', pins: {} }}
      onSave={onSave}
      onOpenChange={onOpenChange}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await started.promise;
  view.unmount();
  saving.resolve(true);
  await saving.promise;
  expect(onOpenChange).not.toHaveBeenCalled();
});
