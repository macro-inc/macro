import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContactPhonesDialog } from './contact-phones-dialog';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(
  initial: string[],
  save = vi.fn<(phones: string[]) => Promise<void>>(async () => {})
) {
  const close = vi.fn();
  render(() => (
    <ContactPhonesDialog
      initial={initial}
      errorMessage={(error) => `Refused: ${(error as Error).message}`}
      onSave={save}
      onClose={close}
    />
  ));
  return { save, close };
}

it('stays open when a save is refused, then saves the numbers typed', async () => {
  const save = vi
    .fn<(phones: string[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error('no country code'))
    .mockResolvedValue(undefined);
  const { close } = open(['+1555010'], save);

  fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
  const second = screen.getByRole('textbox', { name: 'Phone number 2' });
  fireEvent.input(second, { target: { value: '020 123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Refused: no country code'
  );
  expect(close).not.toHaveBeenCalled();

  fireEvent.input(second, { target: { value: '+44 20 123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).toHaveBeenLastCalledWith(['+1555010', '+44 20 123']);
});

it('saves what is left after removing numbers, down to none', async () => {
  const { save, close } = open(['+1555010', '+4420123']);

  fireEvent.click(
    screen.getByRole('button', { name: 'Remove phone number 1' })
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove phone number 1' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).toHaveBeenCalledWith([]);
});

it('cancel closes without saving', () => {
  const { save, close } = open(['+1555010']);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
