import { isErr } from '@core/util/maybeResult';
import {
  type Change,
  type JsonOp,
  type ListOp,
  LoroDoc,
  type MapOp,
  type TextOp,
  type TreeOp,
} from 'loro-crdt';
import { syncServiceClient } from '../../service-sync/client';

export type BaseHistory = {
  readonly userId: string;
  readonly timestamp: UnixTimestamp;
  readonly humanTimestamp: string;
  readonly change: Change;
};

export type HistoryWithDiff<T> = BaseHistory & {
  readonly diff: T;
};

export type Op = ListOp | MapOp | TreeOp | TextOp | JsonOp;

export interface OpSerializer<T> {
  serialize(ops: Op[], doc: LoroDoc): T;
}

type UnixTimestamp = number;
type Milliseconds = number;

type TimeWindow = {
  readonly start: UnixTimestamp;
  readonly end: UnixTimestamp;
};

type ChangeWindow = {
  readonly change: BaseHistory;
  readonly window: TimeWindow;
};

export type HistoryGroup = {
  readonly window: TimeWindow;
  readonly users: ReadonlySet<string>;
  readonly changes: readonly BaseHistory[];
};

export type GroupingConfig = {
  readonly pauseThreshold: Milliseconds;
  /** Minimum number of changes to form a group */
  readonly minChanges: number;
};

const DEFAULT_GROUPING_CONFIG: GroupingConfig = {
  pauseThreshold: 2000,
  minChanges: 1,
};

export type DocumentHistoryOptions = {
  readonly grouping?: GroupingConfig;
};

export type GroupedHistory = {
  readonly representative: BaseHistory;
  readonly group: HistoryGroup;
};

function expandChangeToWindow(
  change: BaseHistory,
  pauseThresholdMs: number
): ChangeWindow {
  const pauseThresholdSec = pauseThresholdMs / 1000;
  return {
    change,
    window: {
      start: change.timestamp,
      end: change.timestamp + pauseThresholdSec,
    },
  };
}

function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function mergeWindows(a: TimeWindow, b: TimeWindow): TimeWindow {
  return {
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
  };
}

function changeInWindow(change: BaseHistory, window: TimeWindow): boolean {
  return change.timestamp >= window.start && change.timestamp <= window.end;
}

/**
 * Finds editing sessions by clustering changes that happen close together in time.
 *
 * Two changes belong to the same session if they're within `pauseThreshold` of each other.
 * Uses interval merging: treat each change as a time window, merge overlapping windows.
 */
export function groupHistory(
  history: readonly BaseHistory[],
  config: GroupingConfig = DEFAULT_GROUPING_CONFIG
): HistoryGroup[] {
  if (history.length === 0) return [];
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const windows = sorted.map((c) =>
    expandChangeToWindow(c, config.pauseThreshold)
  );
  const mergedWindows = mergeOverlappingWindows(windows.map((w) => w.window));
  const groups = mergedWindows.map((window) => createGroup(sorted, window));
  return groups.filter((g) => g.changes.length >= config.minChanges);
}

function mergeOverlappingWindows(windows: TimeWindow[]): TimeWindow[] {
  if (windows.length === 0) return [];

  const merged: TimeWindow[] = [];
  let current = windows[0];

  for (let i = 1; i < windows.length; i++) {
    if (windowsOverlap(current, windows[i])) {
      current = mergeWindows(current, windows[i]);
    } else {
      merged.push(current);
      current = windows[i];
    }
  }
  merged.push(current);

  return merged;
}

function createGroup(
  changes: readonly BaseHistory[],
  window: TimeWindow
): HistoryGroup {
  const groupChanges = changes.filter((c) => changeInWindow(c, window));
  const users = new Set(groupChanges.map((c) => c.userId));

  return {
    window,
    users,
    changes: groupChanges,
  };
}

async function fetchRawHistory(documentId: string): Promise<BaseHistory[]> {
  const maybeSnapshot = await syncServiceClient.getSnapshot({ documentId });
  if (isErr(maybeSnapshot)) {
    console.error('Failed to get snapshot', maybeSnapshot);
    return [];
  }

  const doc = new LoroDoc();
  doc.import(maybeSnapshot[1]);

  const maybeMetadata = await syncServiceClient.getDocumentMetadata({
    documentId,
  });

  if (isErr(maybeMetadata)) {
    console.error('Failed to get document metadata', maybeMetadata);
    return [];
  }

  const metadata = maybeMetadata[1];
  const peerToUserId = new Map(
    metadata.peers.map((p) => [String(p.peer_id), p.user_id])
  );

  const changes = doc.getAllChanges();
  const history: BaseHistory[] = [];

  for (const [peerId, peerChanges] of changes) {
    const userId = peerToUserId.get(peerId);
    if (!userId) continue;

    for (const change of peerChanges) {
      history.push({
        userId,
        timestamp: change.timestamp,
        humanTimestamp: new Date(change.timestamp * 1000).toLocaleString(),
        change,
      });
    }
  }

  return history.sort((a, b) => a.timestamp - b.timestamp);
}

export function applyGrouping(
  history: readonly BaseHistory[],
  config?: GroupingConfig
): GroupedHistory[] {
  const groups = groupHistory(history, config);

  return groups.map((group) => ({
    representative: group.changes[0],
    group,
  }));
}

export async function getDocumentHistory(
  documentId: string,
  options?: DocumentHistoryOptions
): Promise<GroupedHistory[]> {
  const history = await fetchRawHistory(documentId);
  if (history.length === 0) return [];

  const grouped = applyGrouping(history, options?.grouping);
  return grouped;
}
