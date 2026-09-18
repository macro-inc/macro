// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CallInvite } from './call-invite';

afterEach(cleanup);
it('retains the external email after a failed invite and confirms only a successful retry', async () => {
  const invite = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);
  render(() => <CallInvite onInvite={invite} />);
  const input = screen.getByRole('textbox', {
    name: 'Invite by email',
  }) as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'Guest@Outside.Example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(input.value).toBe('Guest@Outside.Example');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await vi.waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      'guest@outside.example'
    )
  );
  expect(invite).toHaveBeenCalledWith('guest@outside.example');
  expect(input.value).toBe('');
});
