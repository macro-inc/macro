import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { fileSelector } from './fileSelector';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// A picker's input must stay reachable while the picker is open: WebKit drops
// the picked files when it garbage-collects a detached input mid-pick.
it('keeps the picker input in the document until the picker answers', () => {
  const button = document.createElement('button');
  document.body.append(button);
  const onSelect = vi.fn();
  const openPickers: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    openPickers.push(this);
  });
  const dispose = createRoot((dispose) => {
    fileSelector(button, () => ({ multiple: true, onSelect }));
    return dispose;
  });

  button.click();
  const picker = openPickers[0];
  expect(picker.isConnected).toBe(true);

  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  Object.defineProperty(picker, 'files', { value: [file] });
  picker.dispatchEvent(new Event('change'));
  expect(onSelect).toHaveBeenCalledWith([file]);
  expect(picker.isConnected).toBe(false);

  button.click();
  const cancelled = openPickers[1];
  expect(cancelled.isConnected).toBe(true);
  cancelled.dispatchEvent(new Event('cancel'));
  expect(cancelled.isConnected).toBe(false);

  dispose();
});
