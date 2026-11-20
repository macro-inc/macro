/**
 * @vitest-environment jsdom
 *
 * A channel thread an agent shows in a session says which channel it is from
 * and opens that channel: at the embedded message, or at a reply inside its
 * thread.
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn(() => Promise.resolve());
const orchestrator = { name: 'orchestrator' };
let channelNames: Record<string, string> = {};

vi.mock('@block-channel/utils/link', () => ({
  navigateToChannelMessage: (...args: unknown[]) => navigate(...args),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => orchestrator,
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: (channelId: string, fallback?: string) => () =>
    channelNames[channelId] ?? fallback,
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => <span aria-hidden="true" />,
}));
// The thread itself is the channel feature's, over message queries; here it
// is a parent and one reply that report clicks the way it does.
vi.mock('@channel/StandaloneThread', () => ({
  ReadonlyThread: (props: {
    messageId: string;
    onClickMessage?: (messageId: string, e: MouseEvent) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={(e) => props.onClickMessage?.(props.messageId, e)}
      >
        Parent message
      </button>
      <button
        type="button"
        onClick={(e) => props.onClickMessage?.('reply-1', e)}
      >
        A reply
      </button>
    </div>
  ),
}));

import { ChannelMessage } from './ChannelMessage';

afterEach(() => {
  navigate.mockClear();
  channelNames = {};
});

describe('ChannelMessage', () => {
  it('names its channel and opens it at the embedded message', () => {
    channelNames = { 'channel-1': 'design-reviews' };
    const view = render(() => (
      <ChannelMessage channelId="channel-1" messageId="message-1" />
    ));
    view.getByText('design-reviews');
    fireEvent.click(view.getByRole('button', { name: 'Open in channel' }));
    expect(navigate).toHaveBeenCalledWith(
      orchestrator,
      'channel-1',
      'message-1',
      undefined
    );
  });

  it('opens a clicked reply inside its thread', () => {
    const view = render(() => (
      <ChannelMessage channelId="channel-1" messageId="message-1" />
    ));
    fireEvent.click(view.getByText('A reply'));
    expect(navigate).toHaveBeenCalledWith(
      orchestrator,
      'channel-1',
      'reply-1',
      'message-1'
    );
    fireEvent.click(view.getByText('Parent message'));
    expect(navigate).toHaveBeenLastCalledWith(
      orchestrator,
      'channel-1',
      'message-1',
      undefined
    );
  });

  it('a channel missing from the viewer list still reads as a channel and links', () => {
    const view = render(() => (
      <ChannelMessage channelId="channel-2" messageId="message-1" />
    ));
    view.getByText('Channel');
    fireEvent.click(view.getByRole('button', { name: 'Open in channel' }));
    expect(navigate).toHaveBeenCalledWith(
      orchestrator,
      'channel-2',
      'message-1',
      undefined
    );
  });
});
