import {
  type AgentArrivals,
  AgentArrivalsProvider,
  createAgentArrivals,
  OPENED_BY_AGENT,
} from '@app/features/agent-navigation/context/agent-arrivals';
import type { Entry, PaneId } from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import { render } from '@solidjs/testing-library';
import { createRoot, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailReadMarker,
  makeDebouncedChannelNotificationReadMarker,
  NotificationReadMarker,
} from '../components/NotificationReadMarker';
import type { NotificationSource } from '../notification-source';

const mocks = vi.hoisted(() => ({
  markInBackground: vi.fn(async () => {}),
  markThread: vi.fn(),
  load: vi.fn(async () => {}),
}));
vi.mock('../notification-helpers', () => ({
  markNotificationsForEntityAsReadInBackground: mocks.markInBackground,
  ensureNotificationSourceLoaded: mocks.load,
}));
vi.mock('@queries/email/thread', () => ({
  useMarkThreadAsSeenMutation: () => ({ mutate: mocks.markThread }),
}));
vi.mock('@queries/email/link', () => ({
  useNonPrimaryEmailLinkIdHeader: () => (linkId: string | undefined) => linkId,
}));

const source = {
  _notificationsQuery: { transport: 'graphql' },
} as NotificationSource;
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
  it('marks ready content immediately without scheduling a timer', () => {
    const view = render(() => (
      <NotificationReadMarker
        notificationSource={source}
        entity={{ type: 'chat', id: 'chat' }}
      />
    ));
    dispose = view.unmount;
    expect(mocks.markInBackground).toHaveBeenCalledExactlyOnceWith(source, {
      type: 'chat',
      id: 'chat',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('marks email immediately and does not repeat the read while it stays mounted', async () => {
    const view = render(() => (
      <EmailReadMarker
        notificationSource={source}
        threadId="thread"
        linkId="secondary-inbox"
      />
    ));
    dispose = view.unmount;
    expect(mocks.markThread).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thread',
      linkId: 'secondary-inbox',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.markThread).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'waits for a cold REST feed, respecting disposal=%s',
    async (leave) => {
      const loaded = Promise.withResolvers<void>();
      mocks.load.mockReturnValueOnce(loaded.promise);
      const restSource = {
        _notificationsQuery: { transport: 'rest' },
      } as NotificationSource;
      const view = render(() => (
        <NotificationReadMarker
          notificationSource={restSource}
          entity={{ type: 'document', id: 'doc' }}
        />
      ));
      dispose = view.unmount;
      expect(mocks.markInBackground).not.toHaveBeenCalled();
      if (leave) view.unmount();
      loaded.resolve();
      await loaded.promise;
      expect(mocks.markInBackground).toHaveBeenCalledTimes(leave ? 0 : 1);
    }
  );

  it('routes automatic entity reads through the rejection-handling helper', async () => {
    const view = render(() => (
      <NotificationReadMarker
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
      <EmailReadMarker
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

const AGENT_ENTRY: Entry = {
  id: 'entry-1',
  location: { route: { matches: [{ id: 'drive-document', params: {} }] } },
  meta: { ...OPENED_BY_AGENT },
};

describe('read markers in a pane an agent opened', () => {
  function inAgentPane(arrivals: AgentArrivals, children: () => JSX.Element) {
    return (
      <AgentArrivalsProvider arrivals={arrivals}>
        <PaneContext.Provider
          value={{
            pane: () => 'pane-1' as PaneId,
            entry: () => AGENT_ENTRY,
            depth: () => 0,
          }}
        >
          {children()}
        </PaneContext.Provider>
      </AgentArrivalsProvider>
    );
  }

  it('wait until the person touches the pane', () => {
    const arrivals = createAgentArrivals();
    const view = render(() =>
      inAgentPane(arrivals, () => (
        <NotificationReadMarker
          notificationSource={source}
          entity={{ type: 'document', id: 'doc' }}
        />
      ))
    );
    dispose = view.unmount;
    expect(mocks.markInBackground).not.toHaveBeenCalled();

    arrivals.release('pane-1' as PaneId);

    expect(mocks.markInBackground).toHaveBeenCalledExactlyOnceWith(source, {
      type: 'document',
      id: 'doc',
    });
  });

  it('keep an email thread unseen until then too', () => {
    const arrivals = createAgentArrivals();
    const view = render(() =>
      inAgentPane(arrivals, () => (
        <EmailReadMarker
          notificationSource={source}
          threadId="thread"
          debounceTime={0}
        />
      ))
    );
    dispose = view.unmount;
    expect(mocks.markThread).not.toHaveBeenCalled();
    expect(mocks.markInBackground).not.toHaveBeenCalled();

    arrivals.release('pane-1' as PaneId);

    expect(mocks.markThread).toHaveBeenCalledOnce();
  });
});
