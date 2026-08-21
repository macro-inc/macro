/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelJoinLinkButton } from './ChannelJoinLinkButton';

const mocks = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn(),
  toastFailure: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));

vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://app.example.com',
}));

vi.mock('@queries/channel/join-links', () => ({
  useGetChannelJoinLinkMutation: () => ({
    get isPending() {
      return mocks.isPending;
    },
    mutateAsync: mocks.mutateAsync,
  }),
}));

vi.mock('@ui', () => ({
  Button: (props: {
    children: JSX.Element;
    disabled?: boolean;
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPending = false;
  mocks.mutateAsync.mockResolvedValue({ join_code: 'join-code' });
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});

describe('ChannelJoinLinkButton', () => {
  it('generates the link lazily and copies the invitation URL', async () => {
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);

    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        channelId: 'channel-1',
      });
      expect(mocks.writeText).toHaveBeenCalledWith(
        'https://app.example.com/app/channel-invite?code=join-code'
      );
      expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    });
  });

  it('reuses the generated code on later clicks', async () => {
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);
    const button = screen.getByRole('button', { name: 'Copy invite link' });

    fireEvent.click(button);
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledOnce());
    fireEvent.click(button);
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(2));

    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  });

  it('does not generate competing codes on rapid clicks', async () => {
    let resolveResponse: (response: { join_code: string }) => void = () => {};
    mocks.mutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);
    const button = screen.getByRole('button', { name: 'Copy invite link' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    resolveResponse({ join_code: 'join-code' });
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(2));
  });

  it('shows failure feedback when clipboard access fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.writeText.mockRejectedValue(new Error('clipboard unavailable'));
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    await waitFor(() => {
      expect(mocks.toastFailure).toHaveBeenCalledWith(
        'Failed to copy channel join link'
      );
    });
    expect(
      screen.getByRole('button', { name: 'Copy invite link' })
    ).toBeTruthy();
  });

  it('does not copy when link generation fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('generation failed'));
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it('disables the control and prevents requests while pending', () => {
    mocks.isPending = true;
    render(() => <ChannelJoinLinkButton channelId="channel-1" />);

    const button = screen.getByRole('button', { name: 'Generating link' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
