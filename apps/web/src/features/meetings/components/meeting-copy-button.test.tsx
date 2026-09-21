// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MeetingCopyButton } from './meeting-copy-button';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('keeps its label and restores the copy icon after feedback, including repeated copies', async () => {
  vi.useFakeTimers();
  render(() => (
    <MeetingCopyButton
      url="https://macro.com/app/meet/test"
      onCopy={async () => {}}
    />
  ));
  const button = screen.getByRole('button', { name: 'Copy Meeting Url' });
  const originalIcon = button.querySelector('svg')?.innerHTML;
  fireEvent.click(button);
  await Promise.resolve();
  expect(button.textContent).toBe('Copy Meeting Url');
  expect(button.querySelector('svg')?.innerHTML).not.toBe(originalIcon);
  expect(screen.getByRole('status').textContent).toBe('Meeting URL copied');
  await vi.advanceTimersByTimeAsync(2000);
  fireEvent.click(button);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(2000);
  expect(screen.getByRole('status').textContent).toBe('Meeting URL copied');
  await vi.advanceTimersByTimeAsync(500);
  expect(screen.getByRole('status').textContent).toBe('');
  expect(button.querySelector('svg')?.innerHTML).toBe(originalIcon);
});

it('offers manual copying after clipboard failure', async () => {
  render(() => (
    <MeetingCopyButton
      url="https://macro.com/app/meet/test"
      onCopy={async () => {
        throw new Error('Clipboard blocked');
      }}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Copy Meeting Url' }));
  expect(
    await screen.findByRole('textbox', { name: 'Call link' })
  ).toHaveProperty('value', 'https://macro.com/app/meet/test');
});
