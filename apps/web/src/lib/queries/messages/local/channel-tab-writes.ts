/**
 * Local writes made by any tab of this browser. The tabs share one device, so
 * a write another tab queued is on the device as soon as its queue stores it,
 * but a tab hears of a change only from the server's frames, which do not
 * come with no connection or before the server has the write. Each tab
 * announces the channels its writes changed, and every runtime tells the
 * channel's open views to read the device again.
 */
const WRITES = 'macro.channel-timeline.writes';

type Written = { channelIds: readonly string[] };

function writesChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(WRITES);
}

/** Tells the other tabs that a write of this tab changed the channel. */
export function announceWritten(channelId: string): void {
  const channel = writesChannel();
  if (!channel) return;
  channel.postMessage({ channelIds: [channelId] } satisfies Written);
  channel.close();
}

/** Calls `listener` with channels another tab's writes changed; returns a stop. */
export function onWrittenElsewhere(
  listener: (channelIds: readonly string[]) => void
): () => void {
  const channel = writesChannel();
  if (!channel) return () => {};
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<Written> | null;
    if (!Array.isArray(data?.channelIds)) return;
    listener(data.channelIds.filter((id) => typeof id === 'string'));
  };
  return () => channel.close();
}
