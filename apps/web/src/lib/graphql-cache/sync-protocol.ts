/**
 * Streamed cache sync: the contract between the app (which builds plans), the
 * cache hosts (which run them), and the server stream. See
 * docs/architecture/streamed-cache-sync.md. Rust mirrors these shapes with
 * serde camelCase.
 */

/** How the server follows one lane's pages. */
export type SyncPaging = 'soup' | 'calendar';

/** Calendar coverage committed when a calendar lane completes. */
export type SyncCalendarCoverage = unknown;

export type SyncLaneKind =
  /** Write every page; record delivered keys as members of this lane. */
  | { kind: 'hydrate' }
  /** Collect IDs only; on completion delete members of `scopes` not listed. */
  | { kind: 'membership'; scopes: readonly string[] }
  /** Write every page; on completion commit `coverage` with the lowest watermark. */
  | { kind: 'calendar'; coverage: SyncCalendarCoverage };

export type SyncLanePlan = {
  /** `[a-z0-9-]{1,64}`; also the key of the lane's saved state. */
  id: string;
  /** Server-safe query text (client-only directives removed). */
  query: string;
  operationName?: string;
  /** Variables for the lane's first page: an initial input or a resume point. */
  variables: Record<string, unknown>;
  paging: SyncPaging;
  /** Stop after at least this many items. Invalid on membership lanes. */
  maxItems?: number;
  kind: SyncLaneKind;
  /** ISO time this lane's pass started; stored with the first page. */
  passStartedAt: string;
  /** Opaque description stored when the lane completes. */
  coverage?: unknown;
};

export type SyncStartArgs = {
  /** Absolute stream URL. */
  url: string;
  /** Extra request headers (mail cache profile, bearer token). */
  headers: Record<string, string>;
  lanes: readonly SyncLanePlan[];
  /** End the stream after this many pages; the next run resumes. */
  maxPages?: number;
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
  | { kind: 'write'; message: string };

export type SyncRunOutcome =
  | { ok: true; result: SyncRunResult }
  | { ok: false; failure: SyncFailure; partial?: SyncRunResult };

/** Saved per-lane state, read from the cache database. */
export type SyncLaneState = {
  id: string;
  /** Resume point of an unfinished pass; null when none is in progress. */
  nextVariables: Record<string, unknown> | null;
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
