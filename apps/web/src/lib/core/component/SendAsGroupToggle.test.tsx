import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { SendAsGroupToggle } from './SendAsGroupToggle';

afterEach(cleanup);

const toggle = () =>
  screen.getByRole('checkbox', {
    name: 'Send As Group Message',
  }) as HTMLInputElement;

it('turns a group message off when clicked', () => {
  const onChange = vi.fn();
  render(() => <SendAsGroupToggle on locked={false} onChange={onChange} />);

  expect(toggle().checked).toBe(true);
  expect(
    screen.getByText('Creates a new group message with all recipients')
  ).toBeTruthy();
  fireEvent.click(toggle());

  expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
});

it('describes one message per recipient when off', () => {
  render(() => (
    <SendAsGroupToggle on={false} locked={false} onChange={vi.fn()} />
  ));

  expect(toggle().checked).toBe(false);
  expect(screen.getByText('Send a message to each recipient')).toBeTruthy();
});

it('ignores clicks while the share is sending', () => {
  const onChange = vi.fn();
  render(() => <SendAsGroupToggle on locked onChange={onChange} />);

  expect(toggle().disabled).toBe(true);
  fireEvent.click(toggle());

  expect(onChange).not.toHaveBeenCalled();
});
