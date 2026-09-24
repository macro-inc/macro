/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewMeetingButton } from '../NewMeetingButton';

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
  return { Dropdown };
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
