import { z } from 'zod';

/**
 * Channels the open views were pushed a change for that the device has not
 * stored yet.
 *
 * The device takes a pushed change from the server's log a moment after the
 * views show it, longer while the cache is busy. A reload inside that moment
 * would leave the device's copy of the channel one change behind what the
 * person saw, and offline it would open that way. Each such channel is
 * therefore noted here first, synchronously, and forgotten once the device is
 * caught up; the next page to start catches up what a page that is gone left
 * noted.
 */

const KEY = 'channel-push-awaiting-device:v1';
/** More than a page could have been pushed in one moment is not kept. */
const MAX_NOTED = 50;

const notedSchema = z.array(z.string());

/** What this page already noted, so a burst of pushes writes once. */
const noted = new Set<string>();

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage the browser refuses leaves pushes as they were before this.
    return undefined;
  }
}

/** The channels a page noted and did not see stored, this one included. */
export function unstoredPushChannels(): string[] {
  try {
    const parsed = notedSchema.safeParse(
      JSON.parse(browserStorage()?.getItem(KEY) ?? '[]')
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(channelIds: string[]): void {
  try {
    browserStorage()?.setItem(KEY, JSON.stringify(channelIds));
  } catch {
    // A full or refused storage leaves the push to the next catch-up.
  }
}

export function noteUnstoredPush(channelId: string): void {
  if (noted.has(channelId)) return;
  noted.add(channelId);
  const others = unstoredPushChannels().filter((id) => id !== channelId);
  write([...others, channelId].slice(-MAX_NOTED));
}

export function forgetUnstoredPush(channelId: string): void {
  noted.delete(channelId);
  const held = unstoredPushChannels();
  if (held.includes(channelId)) write(held.filter((id) => id !== channelId));
}

/** For tests. */
export function resetUnstoredPushes(): void {
  noted.clear();
}
