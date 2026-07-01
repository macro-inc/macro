import type { HistorySession, HistoryVersionId } from '@service-sync/client';
import { syncServiceClient } from '@service-sync/client';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createContext,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  type Setter,
  useContext,
} from 'solid-js';
import { sessionize } from './sessionize';
import {
  buildTimestampIndex,
  checkoutAt as _checkoutAt,
  type TimestampIndex,
  versionIdAt as _versionIdAt,
} from './timestampIndex';

type HistoryContextValue = {
  /** Whether the history overlay is currently open. */
  isViewingHistory: Accessor<boolean>;
  /** Open/close the history overlay directly. */
  setViewingHistory: Setter<boolean>;
  /** The timestamp the scrubber is parked at; null means the live/current state. */
  selectedAt: Accessor<Date | null>;
  /** Set the scrubbed timestamp directly. */
  setSelectedAt: Setter<Date | null>;
  /** Whether the cursor is pinned to the right edge (i.e. the live state). */
  isScrubbedRightmost: Accessor<boolean>;
  /** Set the rightmost/live-edge flag directly. */
  setIsScrubbedRightmost: Setter<boolean>;
  /** Enter history mode at a timestamp (null = live state). */
  enterAt: (at: Date | null) => void;
  /** Enter history mode pinned to the live state. */
  enterRightmost: () => void;
  /** Leave history mode and reset the cursor to live. */
  exit: () => void;
  /** Editing sessions for the timeline, derived locally from the oplog. */
  sessions: Accessor<readonly HistorySession[]>;
  /** True while the snapshot/metadata needed for the session timeline are loading. */
  isLoadingSessions: Accessor<boolean>;
  /** Document editor state at `ms`, via a local Loro checkout. Null until the
   *  history doc is loaded or if there is no history at that time. */
  checkoutAt: (ms: number) => SerializedEditorState | null;
  /** True while the full snapshot powering scrubbing is still downloading. */
  isLoadingHistoryDoc: Accessor<boolean>;
  /** Version id at `ms` for forking the document at that point in history. */
  versionIdAt: (ms: number) => HistoryVersionId | null;
};

const HistoryContext = createContext<HistoryContextValue>();

export function HistoryProvider(props: {
  documentId: Accessor<string>;
  children: JSX.Element;
}) {
  const [isViewingHistory, setViewingHistory] = createSignal(false);
  const [selectedAt, setSelectedAt] = createSignal<Date | null>(null);
  const [isScrubbedRightmost, setIsScrubbedRightmost] = createSignal(true);

  const enterAt = (at: Date | null) => {
    setSelectedAt(at);
    setIsScrubbedRightmost(at === null);
    setViewingHistory(true);
  };

  const enterRightmost = () => {
    setSelectedAt(null);
    setIsScrubbedRightmost(true);
    setViewingHistory(true);
  };

  const exit = () => {
    setViewingHistory(false);
    setSelectedAt(null);
    setIsScrubbedRightmost(true);
  };

  // Download the full snapshot once and drive both the session timeline and
  // local scrubbing from it. The full snapshot (not updates) is required so
  // getAllChanges() carries the per-change timestamp metadata.
  const [historyDoc] = createResource(
    () => props.documentId(),
    async (documentId) => {
      const result = await syncServiceClient.getSnapshot({ documentId });
      if (result.isErr()) throw new Error(String(result.error));
      const doc = new LoroDoc();
      doc.import(result.value);
      return doc;
    }
  );

  // Peer -> user mapping for labelling sessions; lightweight JSON.
  const [peerMap] = createResource(
    () => props.documentId(),
    async (documentId) => {
      const result = await syncServiceClient.getDocumentMetadata({
        documentId,
      });
      if (result.isErr()) throw new Error(String(result.error));
      return new Map(
        result.value.peers.map((p) => [String(p.peer_id), p.user_id])
      );
    }
  );

  const historyIndex = createMemo<TimestampIndex | null>(() => {
    const doc = historyDoc();
    if (!doc) return null;
    return buildTimestampIndex(doc);
  });

  // Sessions derived locally from the oplog: one edit event per change, grouped
  // per user.
  const sessions = createMemo<readonly HistorySession[]>(() => {
    const doc = historyDoc();
    const peers = peerMap();
    if (!doc || !peers) return [];

    const events: { userId: string; tMs: number }[] = [];
    for (const [peer, changes] of doc.getAllChanges()) {
      const userId = peers.get(peer) ?? 'unknown';
      for (const change of changes) {
        events.push({ userId, tMs: change.timestamp * 1000 });
      }
    }
    return sessionize(events);
  });

  const checkoutAt = (ms: number): SerializedEditorState | null => {
    const index = historyIndex();
    return index ? _checkoutAt(index, ms) : null;
  };

  const versionIdAt = (ms: number): HistoryVersionId | null => {
    const index = historyIndex();
    return index ? _versionIdAt(index, ms) : null;
  };

  const value: HistoryContextValue = {
    isViewingHistory,
    setViewingHistory,
    selectedAt,
    setSelectedAt,
    isScrubbedRightmost,
    setIsScrubbedRightmost,
    enterAt,
    enterRightmost,
    exit,
    sessions,
    isLoadingSessions: () => historyDoc.loading || peerMap.loading,
    checkoutAt,
    isLoadingHistoryDoc: () => historyDoc.loading,
    versionIdAt,
  };

  return (
    <HistoryContext.Provider value={value}>
      {props.children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context)
    throw new Error('useHistory must be used inside HistoryProvider');
  return context;
}
