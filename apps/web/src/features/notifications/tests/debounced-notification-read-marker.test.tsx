import { render } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DebouncedNotificationReadMarker,
  EmailDebouncedReadMarker,
  makeDebouncedChannelNotificationReadMarker,
} from '../components/DebouncedNotificationReadMarker';
import type { NotificationSource } from '../notification-source';

const mocks = vi.hoisted(() => ({
  markInBackground: vi.fn(async () => {}),
  markThread: vi.fn(),
}));
vi.mock('../notification-helpers', () => ({
  markNotificationsForEntityAsReadInBackground: mocks.markInBackground,
}));
vi.mock('@queries/email/thread', () => ({
  useMarkThreadAsSeenMutation: () => ({ mutate: mocks.markThread }),
}));
vi.mock('@queries/email/link', () => ({
  useNonPrimaryEmailLinkIdHeader: () => (linkId: string | undefined) => linkId,
}));

const source = {} as NotificationSource;
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

describe('background notification read markers', () => {
  it('routes automatic entity reads through the rejection-handling helper', async () => {
    const view = render(() => (
      <DebouncedNotificationReadMarker
        notificationSource={source}
        entity={{ type: 'document', id: 'doc' }}
        debounceTime={10}
      />
    ));
    dispose = view.unmount;
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.markInBackground).toHaveBeenCalledExactlyOnceWith(source, {
      type: 'document',
      id: 'doc',
    });
  });

  it('coalesces imperative channel reads through the rejection-handling helper', async () => {
    const trigger = createRoot((cleanup) => {
      dispose = cleanup;
      return makeDebouncedChannelNotificationReadMarker({
        notificationSource: source,
        channelId: 'channel',
        debounceTime: 10,
      });
    });
    trigger();
    trigger();
    trigger();
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.markInBackground).toHaveBeenCalledExactlyOnceWith(source, {
      type: 'channel',
      id: 'channel',
    });
  });

  it('keeps email read marking independent of pending notification work', async () => {
    let complete!: () => void;
    mocks.markInBackground.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        })
    );
    const view = render(() => (
      <EmailDebouncedReadMarker
        notificationSource={source}
        threadId="thread"
        linkId="secondary-inbox"
        debounceTime={10}
      />
    ));
    dispose = view.unmount;
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.markInBackground).toHaveBeenCalledExactlyOnceWith(source, {
      type: 'email_thread',
      id: 'thread',
    });
    expect(mocks.markThread).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thread',
      linkId: 'secondary-inbox',
    });
    complete();
  });
});
