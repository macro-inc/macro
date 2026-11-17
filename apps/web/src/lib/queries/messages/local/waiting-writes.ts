import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { match, P } from 'ts-pattern';
import { refreshChannelViews } from './catch-up';
import { channelCacheHost } from './flag';

type WaitingWrite = {
  type: 'channel-write-waiting';
  channelId: string;
  /** The window that made the write; it already shows it. */
  windowId: string;
  /** Makes each payload unique, so the bus's storage fallback fires. */
  sentAt: number;
};

const WINDOW_ID = crypto.randomUUID();

const waitingWrites = createCrossTabBus<WaitingWrite>({
  channelName: 'channel-write-waiting',
  storageKey: 'macro.channel-write-waiting',
  parse: (value) =>
    match(value)
      .with(
        {
          type: 'channel-write-waiting',
          channelId: P.string,
          windowId: P.string,
          sentAt: P.number,
        },
        (message) => message
      )
      .otherwise(() => null),
  // Both transports deliver one announcement.
  getMessageKey: (message) =>
    `${message.windowId}:${message.channelId}:${message.sentAt}`,
});

let stopWatching: (() => void) | undefined;

/**
 * Tells this device's other windows that a write to the channel waits in the
 * device queue. No push reaches them while it waits, so they would not show
 * it until it is sent.
 */
export function announceWaitingWrite(channelId: string): void {
  waitingWrites.publish({
    type: 'channel-write-waiting',
    channelId,
    windowId: WINDOW_ID,
    sentAt: Date.now(),
  });
}

/** Has this window read a channel again from the device when another window's write to it waits. */
export function watchWaitingWrites(): void {
  stopWatching ??= waitingWrites.subscribe((message) => {
    // With channels back on REST there is no device copy to read again.
    if (message.windowId === WINDOW_ID || !channelCacheHost()) return;
    refreshChannelViews(message.channelId);
  });
}

/** For tests. */
export function resetWaitingWrites(): void {
  stopWatching?.();
  stopWatching = undefined;
}
