import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  pick: vi.fn<(openFileInput: () => void) => Promise<File[]>>(),
}));
vi.mock('@core/mobile/nativePhotoLibrary', () => ({
  pickPhotoLibraryMediaOrFiles: native.pick,
}));

import { pickCanvasMedia } from './pick-media';

const photo = () => new File(['x'], 'photo.heic');
const picker = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Upload media"]');
/** Stand in for the browser: no native library, so the file input opens. */
const useFileInput = () =>
  native.pick.mockImplementation(async (openFileInput) => {
    openFileInput();
    return [];
  });
const choose = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, 'files', { value: files });
  input.dispatchEvent(new Event('change'));
};

afterEach(() => {
  picker()?.remove();
  native.pick.mockReset();
});

it('opens a file picker for images and videos inside the call', () => {
  useFileInput();
  const click = vi.spyOn(HTMLInputElement.prototype, 'click');

  const picking = pickCanvasMedia(() => {});

  // Before anything is awaited: the click still belongs to the tap.
  expect(click).toHaveBeenCalledOnce();
  expect(picker()?.accept).toBe('image/*,video/*,.heic,.heif');
  expect(picker()?.multiple).toBe(true);
  click.mockRestore();
  return picking;
});

it('keeps the input in the document until the picker answers', async () => {
  useFileInput();
  const onFiles = vi.fn();
  await pickCanvasMedia(onFiles);
  const input = picker();
  if (!input) throw new Error('The file input left the document early');

  const file = photo();
  choose(input, [file]);

  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(picker()).toBeNull();
});

it('reports nothing when the picker is dismissed', async () => {
  useFileInput();
  const onFiles = vi.fn();
  await pickCanvasMedia(onFiles);

  picker()?.dispatchEvent(new Event('cancel'));

  expect(onFiles).not.toHaveBeenCalled();
  expect(picker()).toBeNull();
});

it('clears away a picker that was dismissed without a word', async () => {
  // iOS says nothing when its menu of sources is dismissed.
  useFileInput();
  await pickCanvasMedia(() => {});
  const dismissed = picker();

  await pickCanvasMedia(() => {});

  expect(dismissed?.isConnected).toBe(false);
  expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
});

it('takes what the native photo library returns without a file input', async () => {
  const file = photo();
  native.pick.mockResolvedValue([file]);
  const onFiles = vi.fn();

  await pickCanvasMedia(onFiles);

  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(picker()).toBeNull();
});
