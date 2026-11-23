import { fireAndForget } from '@core/util/fireAndForget';

/**
 * Counts, per host, the commits this page sends that delete what a channel
 * holds: a reset of one channel, or an eviction of any. A server fill marks
 * the count before it fetches and commits its coverage only if it is
 * unchanged when the commit is sent: coverage committed after such a delete
 * would describe records the delete already removed, and the device would
 * then show a covered, empty stretch. The host applies commits in the order
 * they are sent, so a delete sent after the coverage removes it too.
 *
 * Deletes sent by another tab are not counted here: `holdAgainstDeletes` and
 * `whileNoFills` keep them out of a fill instead.
 */
type Counts = { all: number; channels: Map<string, number> };

const counts = new WeakMap<object, Counts>();

function countsOf(host: object): Counts {
  let entry = counts.get(host);
  if (!entry) {
    entry = { all: 0, channels: new Map() };
    counts.set(host, entry);
  }
  return entry;
}

/** The delete count for a channel; compare it with `unchangedSince`. */
export function channelResetMark(host: object, channelId: string): string {
  const entry = countsOf(host);
  return `${entry.all}:${entry.channels.get(channelId) ?? 0}`;
}

/** Whether nothing deleted the channel's records since `mark`. */
export function unchangedSince(
  host: object,
  channelId: string,
  mark: string
): boolean {
  return channelResetMark(host, channelId) === mark;
}

/** Call right before sending a commit that deletes the channel's records. */
export function noteChannelReset(host: object, channelId: string): void {
  const entry = countsOf(host);
  entry.channels.set(channelId, (entry.channels.get(channelId) ?? 0) + 1);
}

/** Call right before sending an eviction, which can take any channel. */
export function noteChannelsEvicted(host: object): void {
  countsOf(host).all += 1;
}

/**
 * Deletes sent by another tab: they reach the shared engine, but not this
 * page's counts. A server fill holds this lock shared from before it fetches
 * until its coverage is sent; a delete takes it exclusive, so it never lands
 * between a fill's store and its coverage in any tab.
 */
const DELETE_FENCE = 'macro.channel-timeline.deletes';

/** How long a delete waits for other fills before it gives up. */
export const DELETE_FENCE_WAIT_MS = 5_000;

/** A fill's place in the fence; release it once its coverage is sent. */
export type FillHold = { release(): void };

const NO_FENCE: FillHold = { release() {} };

function locks(): LockManager | null {
  return typeof navigator === 'undefined' ? null : (navigator.locks ?? null);
}

/**
 * Enters the fence before a fill fetches. Null when a delete holds the fence
 * or waits for it: the fill then commits no coverage, as the delete may take
 * what it stores. Without Web Locks (one page per device, as natively, or
 * tests) only this page's counts guard fills.
 */
export function holdAgainstDeletes(): Promise<FillHold | null> {
  const manager = locks();
  if (!manager) return Promise.resolve(NO_FENCE);
  return new Promise((resolve) => {
    const request = async () => {
      try {
        await manager.request(
          DELETE_FENCE,
          { mode: 'shared', ifAvailable: true },
          (lock) => {
            if (!lock) {
              resolve(null);
              return undefined;
            }
            return new Promise<void>((release) => resolve({ release }));
          }
        );
      } catch (error) {
        // Without a hold the fill commits no coverage.
        resolve(null);
        throw error;
      }
    };
    fireAndForget(request(), 'channel-local-sync');
  });
}

/**
 * Runs a delete once no fill in any tab is between its store and its
 * coverage. `busy` when fills held the fence past `waitMs`; `orRun` then runs
 * the delete anyway, for one that cannot wait for a later pass.
 */
export async function whileNoFills<T>(
  run: () => Promise<T>,
  options: { waitMs?: number; orRun?: boolean } = {}
): Promise<T | 'busy'> {
  const manager = locks();
  if (!manager) return run();
  const waited = AbortSignal.timeout(options.waitMs ?? DELETE_FENCE_WAIT_MS);
  try {
    return await manager.request(
      DELETE_FENCE,
      { mode: 'exclusive', signal: waited },
      run
    );
  } catch (error) {
    // Only the wait timed out; a failed delete is the caller's to handle.
    if (!waited.aborted || error !== waited.reason) throw error;
    return options.orRun ? run() : 'busy';
  }
}
