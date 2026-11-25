/**
 * Whether the backfill that fills the cached channel directory has finished
 * a pass. The paged backfill saves a checkpoint per lane; the streamed sync
 * saves each lane's state in the cache database. The directory reads either
 * through `LaneProgressSource`.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import type { SyncLaneState } from '@graphql-cache/sync-protocol';
import {
  loadSoupBackfillCheckpoint,
  type SoupBackfillCheckpoint,
  soupBackfillLaneCompleted,
  soupBackfillLaneFailed,
  watchSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import { CHANNEL_DIRECTORY_LANE } from './directory-lane';

/** What the channel lane says of the current storage generation.
 * `viewsCurrent`: a pass that started at or after the session's start has
 * finished, so it reread every record. */
export type LaneProgress = {
  complete: boolean;
  failed: boolean;
  viewsCurrent: boolean;
};

export const LANE_NOT_STARTED: LaneProgress = {
  complete: false,
  failed: false,
  viewsCurrent: false,
};

export function sameLaneProgress(a: LaneProgress, b: LaneProgress): boolean {
  return (
    a.complete === b.complete &&
    a.failed === b.failed &&
    a.viewsCurrent === b.viewsCurrent
  );
}

export type LaneProgressSource = {
  /** The lane's progress in the storage generation `scope`. */
  read(scope: string): Promise<LaneProgress>;
  /** Calls `onProgress` whenever the lane saved progress, from any tab. */
  watch(onProgress: () => void): () => void;
};

/** Whether `startedAt` (an ISO time) is at or after `time`. */
function startedSince(startedAt: string | null, time: number): boolean {
  if (startedAt === null) return false;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && started >= time;
}

/** Whether the lane's last finished pass started at or after `time`: a
 * finished pass leaves its own start as the watermark. */
function laneReadSince(checkpoint: SoupBackfillCheckpoint, time: number) {
  return (
    checkpoint.completedAt !== null &&
    startedSince(checkpoint.updatedSince, time)
  );
}

/** The paged backfill's channel lane: its checkpoint, saved after every page
 * in whichever tab runs it. */
export function checkpointLaneProgress(
  userId: string,
  sessionStartedAt: number
): LaneProgressSource {
  return {
    read: async (scope) => {
      const complete = soupBackfillLaneCompleted(
        userId,
        CHANNEL_DIRECTORY_LANE,
        scope
      );
      return {
        complete,
        failed:
          !complete &&
          soupBackfillLaneFailed(userId, CHANNEL_DIRECTORY_LANE, scope),
        viewsCurrent:
          complete &&
          laneReadSince(
            loadSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_LANE),
            sessionStartedAt
          ),
      };
    },
    watch: (onProgress) =>
      watchSoupBackfillCheckpoint(userId, CHANNEL_DIRECTORY_LANE, onProgress),
  };
}

/** The streamed sync's lane that pages every channel the viewer can see
 * (`crates/soup_sync_stream/src/catalog.rs`). */
export const STREAMED_CHANNEL_LANE = 'channels';

/** How often the streamed lane's state is read while it has not finished a
 * pass this session. */
export const STREAMED_LANE_POLL_MS = 2_000;

/**
 * The streamed sync's channel lane, read from the cache database, which
 * every tab shares and a storage reset wipes. A stream reports no failure of
 * its own: one that stops is seen as a stall. The state is polled until the
 * lane has finished a pass that started this session, and again after a
 * storage reset.
 */
export function streamedLaneProgress(
  host: Pick<CacheHost, 'onCacheGenerationChanged'> & {
    syncState(): Promise<SyncLaneState[]>;
  },
  sessionStartedAt: number,
  pollMs = STREAMED_LANE_POLL_MS
): LaneProgressSource {
  const lane = async () =>
    (await host.syncState()).find(({ id }) => id === STREAMED_CHANNEL_LANE);
  const progress = (state: SyncLaneState | undefined): LaneProgress => {
    const complete = !!state?.completedAt;
    return {
      complete,
      failed: false,
      viewsCurrent:
        complete && startedSince(state?.watermark ?? null, sessionStartedAt),
    };
  };
  return {
    read: async () => progress(await lane()),
    watch: (onProgress) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      let last: string | undefined;
      const poll = async () => {
        let state: SyncLaneState | undefined;
        try {
          state = await lane();
        } catch {
          // A cache that cannot answer says nothing new.
          return;
        }
        const seen = JSON.stringify([
          state?.pages,
          state?.items,
          state?.completedAt,
          state?.watermark,
        ]);
        if (seen !== last) {
          last = seen;
          onProgress();
        }
        if (progress(state).viewsCurrent) stop();
      };
      const stop = () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      };
      const start = () => {
        if (timer !== undefined) return;
        timer = setInterval(
          () => fireAndForget(poll(), 'channel-directory-sync-lane'),
          pollMs
        );
      };
      start();
      const unsubscribe = host.onCacheGenerationChanged((change) => {
        // The lane starts over in the new storage.
        if (change.storage === 'reset') {
          last = undefined;
          start();
        }
      });
      return () => {
        stop();
        unsubscribe();
      };
    },
  };
}
