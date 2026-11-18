/**
 * Streamed cache sync: the contract between the app (which runs passes), the
 * cache hosts (which run streams), and the server stream (which plans each
 * pass's lanes). See docs/architecture/streamed-cache-sync.md. Rust mirrors
 * these shapes with serde camelCase.
 */

/** The sync pass a run streams; the server plans each pass's lanes. */
export type SyncPass = 'first' | 'second';

export type SyncStartArgs = {
  /** Absolute stream URL. */
  url: string;
  /** Extra request headers (mail cache profile, bearer token). */
  headers: Record<string, string>;
  pass: SyncPass;
  /** End the stream after this many pages; the next run resumes. */
  maxPages?: number;
  /** Sync calendar windows in the app's IANA time zone; absent while calendars read REST. */
  calendar?: { timeZone: string };
  /** Leave out lanes that completed at or after this ISO time: they are current for this run. */
  completedSince?: string;
  /** Lanes the server leaves out of this stream. */
  skipLanes?: readonly string[];
};

export type SyncLaneRunSummary = {
  id: string;
  pages: number;
  items: number;
  /** Time spent writing this lane's pages into the cache. */
  writeMs: number;
  /** The lane reached laneDone in this run. */
  done: boolean;
  /**
   * Why the lane failed in this run: its `laneError` message, or the page the
   * cache refused. The other lanes carry on; the failed lane keeps its saved
   * state, so the next run resumes it.
   */
  error?: string;
};

export type SyncRunResult = {
  /** `complete`: every lane finished or failed (see `SyncLaneRunSummary.error`). */
  reason: 'complete' | 'maxPages';
  durationMs: number;
  /** Response bytes read. */
  bytes: number;
  lanes: SyncLaneRunSummary[];
};

export type SyncFailure =
  | { kind: 'busy' }
  | { kind: 'unsupported' }
  | { kind: 'aborted' }
  | { kind: 'http'; status: number }
  | { kind: 'stream'; message: string }
  /**
   * The host gave the connection up: no response, or no response bytes, for
   * its stall limit (90 s). A healthy stream is never silent that long.
   */
  | { kind: 'stalled' }
  | { kind: 'write'; message: string };

export type SyncRunOutcome =
  | { ok: true; result: SyncRunResult }
  | { ok: false; failure: SyncFailure; partial?: SyncRunResult };

/** Saved per-lane state, read from the cache database. */
export type SyncLaneState = {
  id: string;
  /** The server's checkpoint of an unfinished pass, sent back to resume it; null when none is in progress. */
  resume: unknown;
  /** Pages and items written in the current (or last) pass. */
  pages: number;
  items: number;
  passStartedAt: string | null;
  /** When the last pass completed. */
  completedAt: string | null;
  /** `passStartedAt` of the last completed pass: "changed since" for the next one. */
  watermark: string | null;
  /** `coverage` of the last completed pass. */
  coverage: unknown;
};

/** Optional cache host capability; absent on hosts that cannot stream. */
export interface SyncHost {
  syncStart(args: SyncStartArgs): Promise<SyncRunOutcome>;
  syncStop(): Promise<void>;
  syncState(): Promise<SyncLaneState[]>;
}
