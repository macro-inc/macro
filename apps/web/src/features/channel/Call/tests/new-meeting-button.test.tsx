/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewMeetingButton } from '../NewMeetingButton';

const mocks = vi.hoisted(() => ({
  flag: () => ({ enabled: true, loading: false }),
}));
vi.mock('../../../meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => mocks.flag,
}));
beforeEach(() => {
  mocks.flag = () => ({ enabled: true, loading: false });
});

vi.mock('@app/features/meetings/manage-meetings-dialog', () => ({
  ManageMeetingsDialog: () => <div role="dialog">Manage call links</div>,
}));
vi.mock('@ui', () => {
  type Children = { children?: JSX.Element };
  const Dropdown = (props: Children) => <>{props.children}</>;
  Dropdown.Content = Dropdown;
  Dropdown.Trigger = (props: Children) => <button>{props.children}</button>;
  Dropdown.Item = (props: Children & { onSelect: () => void }) => (
    <button onClick={props.onSelect}>{props.children}</button>
  );
  const Button = (props: Children & { onClick: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  );
  return { Button, Dropdown };
});
afterEach(cleanup);

describe('calls list creation entry', () => {
  it('keeps the existing channel calling entry available', () => {
    const onChannelCall = vi.fn();
    render(() => <NewMeetingButton onChannelCall={onChannelCall} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Call a channel or contact' })
    );
    expect(onChannelCall).toHaveBeenCalledOnce();
  });

  it('keeps call-link management available', () => {
    render(() => <NewMeetingButton onChannelCall={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage call links' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

it('keeps channel creation available while loading/off and closes management when disabled', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  const onChannelCall = vi.fn();
  render(() => <NewMeetingButton onChannelCall={onChannelCall} />);
  expect(
    screen.queryByRole('button', { name: 'Manage call links' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New call' }));
  expect(onChannelCall).toHaveBeenCalledOnce();
  setFlag({ enabled: false, loading: false });
  expect(
    screen.queryByRole('button', { name: 'Manage call links' })
  ).toBeNull();

  setFlag({ enabled: true, loading: false });
  fireEvent.click(screen.getByRole('button', { name: 'Manage call links' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New call' }));
  expect(onChannelCall).toHaveBeenCalledTimes(2);
  setFlag({ enabled: true, loading: false });
  expect(screen.queryByRole('dialog')).toBeNull();
});
