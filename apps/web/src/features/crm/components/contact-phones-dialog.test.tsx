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

it('stays open when a save is refused, then saves the numbers typed', async () => {
  const save = vi
    .fn<(phones: string[]) => Promise<void>>()
    .mockRejectedValueOnce(new Error('not a number with its country code'))
    .mockResolvedValue(undefined);
  const close = vi.fn();
  render(() => (
    <ContactPhonesDialog initial={['+1555010']} onSave={save} onClose={close} />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
  const second = screen.getByRole('textbox', { name: 'Phone number 2' });
  fireEvent.input(second, { target: { value: '020 123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();

  fireEvent.input(second, { target: { value: '+44 20 123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add number' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(save).toHaveBeenLastCalledWith(['+1555010', '+44 20 123']);
});
