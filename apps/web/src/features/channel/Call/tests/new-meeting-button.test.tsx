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

describe('calendar creation entry', () => {
  it('hides the external instant-call creation flow', () => {
    render(() => <NewMeetingButton />);
    expect(
      screen.queryByRole('button', { name: /Start instant call/ })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /Schedule call/ })).toBeNull();
  });
  it('keeps the existing channel calling entry available', () => {
    const onChannelCall = vi.fn();
    render(() => <NewMeetingButton onChannelCall={onChannelCall} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Call a channel or contact' })
    );
    expect(onChannelCall).toHaveBeenCalledOnce();
  });

  it('keeps call-link management available', () => {
    render(() => <NewMeetingButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage call links' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
