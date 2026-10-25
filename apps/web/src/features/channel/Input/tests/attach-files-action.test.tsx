/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { InputProvider } from '../context';
import { AttachFilesAction } from '../InputActions';

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
        trigger={(open) => <button onClick={open}>Upload</button>}
      />
    </InputProvider>
  ));
  const picker =
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const click = vi.spyOn(picker, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(click).toHaveBeenCalledOnce();
  expect(picker.hasAttribute('accept')).toBe(false);
  const file = new File(['example'], 'example.txt');
  fireEvent.change(picker, { target: { files: [file] } });
  expect(attachFiles).toHaveBeenCalledWith([file]);
  expect(picker.value).toBe('');
  view.unmount();
});
