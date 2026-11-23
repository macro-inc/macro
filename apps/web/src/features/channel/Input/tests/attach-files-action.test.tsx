/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CHANNEL_FILE_PICKER_ACCEPT } from '../accepted-file-types';
import { InputProvider } from '../context';
import { AttachFilesAction } from '../InputActions';

const platform = vi.hoisted(() => ({ current: 'web' }));
vi.mock('@core/util/platform', () => ({
  isPlatform: (target: string | string[]) =>
    Array.isArray(target)
      ? target.includes(platform.current)
      : target === platform.current,
}));

afterEach(() => {
  platform.current = 'web';
});

it('routes a custom trigger through the existing picker and attachment command', () => {
  const attachFiles = vi.fn(async () => {});
  const view = render(() => (
    <InputProvider
      value={{
        view: () => ({ mode: 'channel' }),
        commands: {
          attachFiles,
          send: async () => false,
          toggleFormatRibbon() {},
          close() {},
          removeAttachment() {},
        },
      }}
    >
      <AttachFilesAction
        accept={null}
        trigger={(open, images) => (
          <>
            <button onClick={open}>Upload</button>
            <button onClick={images}>Photos</button>
          </>
        )}
      />
    </InputProvider>
  ));
  const picker =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const click = vi.spyOn(picker, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(click).toHaveBeenCalledOnce();
  expect(picker.hasAttribute('accept')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
  expect(picker.accept).toBe('image/*');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(picker.hasAttribute('accept')).toBe(false);
  const file = new File(['example'], 'example.txt');
  fireEvent.change(picker, { target: { files: [file] } });
  expect(attachFiles).toHaveBeenCalledWith([file]);
  expect(picker.value).toBe('');
  view.unmount();
});

function renderDefaultPicker() {
  const view = render(() => (
    <InputProvider
      value={{
        view: () => ({ mode: 'channel' }),
        commands: {
          attachFiles: async () => {},
          send: async () => false,
          toggleFormatRibbon() {},
          close() {},
          removeAttachment() {},
        },
      }}
    >
      <AttachFilesAction
        trigger={(open, images) => (
          <>
            <button onClick={open}>Upload</button>
            <button onClick={images}>Photos</button>
          </>
        )}
      />
    </InputProvider>
  ));
  const picker =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  vi.spyOn(picker, 'click').mockImplementation(() => {});
  return { view, picker };
}

it('narrows the default picker to channel file types in a browser', () => {
  platform.current = 'web';
  const { view, picker } = renderDefaultPicker();
  expect(picker.accept).toBe(CHANNEL_FILE_PICKER_ACCEPT);
  fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(picker.accept).toBe(CHANNEL_FILE_PICKER_ACCEPT);
  view.unmount();
});

it('leaves the default picker unfiltered in the desktop app', () => {
  platform.current = 'desktop';
  const { view, picker } = renderDefaultPicker();
  expect(picker.hasAttribute('accept')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
  expect(picker.accept).toBe('image/*');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(picker.hasAttribute('accept')).toBe(false);
  view.unmount();
});
