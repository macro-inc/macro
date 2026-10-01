/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelInviteLink } from './channel-invite-link';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
afterEach(cleanup);

describe('channel invitation links', () => {
  it('creates a new link on each opening and copies the displayed URL', async () => {
    const createLink = vi
      .fn()
      .mockResolvedValueOnce('https://macro.com/app/c/first')
      .mockResolvedValueOnce('https://macro.com/app/c/second');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const first = render(() => <ChannelInviteLink createLink={createLink} />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Channel invite link') as HTMLInputElement).value
      ).toContain('/first')
    );
    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('https://macro.com/app/c/first');
    first.unmount();
    render(() => <ChannelInviteLink createLink={createLink} />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Channel invite link') as HTMLInputElement).value
      ).toContain('/second')
    );
    expect(createLink).toHaveBeenCalledTimes(2);
  });
  it('allows retry after generation fails', async () => {
    const createLink = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('https://macro.com/app/c/retry');
    render(() => <ChannelInviteLink createLink={createLink} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Channel invite link') as HTMLInputElement).value
      ).toContain('/retry')
    );
  });
  it('keeps the selectable URL when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(() => (
      <ChannelInviteLink
        createLink={async () => 'https://macro.com/app/c/link'}
      />
    ));
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Channel invite link') as HTMLInputElement).value
      ).toContain('/link')
    );
    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('manually')
    );
  });
});
