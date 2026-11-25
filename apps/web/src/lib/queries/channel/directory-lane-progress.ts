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
  /** Calls `onProgress` whenever the lane saved progress, from any tab.
   * A source that polls stops once `settled` (the directory's views are
   * current, whichever source made them so) and starts over after a storage
   * reset. */
  watch(onProgress: () => void, settled: () => boolean): () => void;
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
 * in whichever tab runs it. Without `failures`, a pass the lane gave up on
 * reads as unfinished rather than failed: while the app streams, the paged
 * lane no longer runs, so a failure an earlier session left stays saved; and
 * a paged pass that fails after the stream fell back stops saving, which the
 * directory sees as a stall. */
export function checkpointLaneProgress(
  userId: string,
  sessionStartedAt: number,
  { failures = true }: { failures?: boolean } = {}
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
          failures &&
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

/** How often the streamed lane's state is read while it changes. */
export const STREAMED_LANE_POLL_MS = 2_000;
/** The longest wait between reads while the state stays the same and the
 * lane has not completed: a third of the directory's stall window
 * (`LANE_STALL_MS`), timed from each read's start, so a stream that moves is
 * seen moving whatever a read takes. */
export const STREAMED_LANE_POLL_MAX_MS = 10_000;
/** The same once the lane completed: a stall no longer matters, only a later
 * pass that makes views current. */
export const STREAMED_LANE_POLL_COMPLETE_MAX_MS = 60_000;

/**
 * The streamed sync's channel lane, read from the cache database, which
 * every tab shares and a storage reset wipes. A stream reports no failure of
 * its own: one that stops is seen as a stall. The state is read every 2 s
 * while it changes, backing off while it does not (to every 10 s, or every
 * minute once the lane completed), until the lane has finished a pass that
 * started this session or the directory is `settled`; a storage reset starts
 * it over.
 */
export function streamedLaneProgress(
  host: Pick<CacheHost, 'onCacheGenerationChanged'> & {
    syncState(): Promise<SyncLaneState[]>;
  },
  sessionStartedAt: number
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
    watch: (onProgress, settled) => {
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let delay = STREAMED_LANE_POLL_MS;
      let last: string | undefined;
      // Bumped by a storage reset, so a read of the old storage still in
      // flight neither reports nor schedules.
      let round = 0;
      // Timed from the read's start, so a slow read does not widen the gap.
      let readStartedAt = 0;
      const schedule = (current: number) => {
        timer = setTimeout(
          () => fireAndForget(poll(current), 'channel-directory-sync-lane'),
          Math.max(0, readStartedAt + delay - Date.now())
        );
      };
      const poll = async (current: number) => {
        timer = undefined;
        readStartedAt = Date.now();
        let state: SyncLaneState | undefined;
        let answered = true;
        try {
          state = await lane();
        } catch {
          // A cache that cannot answer says nothing new.
          answered = false;
        }
        if (disposed || current !== round) return;
        const seen = JSON.stringify([
          state?.pages,
          state?.items,
          state?.completedAt,
          state?.watermark,
        ]);
        if (answered && seen !== last) {
          last = seen;
          delay = STREAMED_LANE_POLL_MS;
          onProgress();
          if (disposed) return;
        } else {
          const ceiling = progress(state).complete
            ? STREAMED_LANE_POLL_COMPLETE_MAX_MS
            : STREAMED_LANE_POLL_MAX_MS;
          delay = Math.min(delay * 2, ceiling);
        }
        if ((answered && progress(state).viewsCurrent) || settled()) return;
        schedule(current);
      };
      const start = () => {
        if (timer !== undefined) clearTimeout(timer);
        round += 1;
        delay = STREAMED_LANE_POLL_MS;
        last = undefined;
        readStartedAt = Date.now();
        schedule(round);
      };
      start();
      const unsubscribe = host.onCacheGenerationChanged((change) => {
        // The lane starts over in the new storage.
        if (change.storage === 'reset') start();
      });
      return () => {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
      };
    },
  };
}

/**
 * Progress as the furthest of `sources` has it: the app streams or pages,
 * and falls back from the stream to paging, so whichever of them filled the
 * cache answers.
 */
export function eitherLaneProgress(
  ...sources: readonly LaneProgressSource[]
): LaneProgressSource {
  return {
    read: async (scope) => {
      const read = await Promise.all(
        sources.map((source) => source.read(scope))
      );
      const complete = read.some((progress) => progress.complete);
      return {
        complete,
        failed: !complete && read.some((progress) => progress.failed),
        viewsCurrent: read.some((progress) => progress.viewsCurrent),
      };
    },
    watch: (onProgress, settled) => {
      const stops = sources.map((source) => source.watch(onProgress, settled));
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
