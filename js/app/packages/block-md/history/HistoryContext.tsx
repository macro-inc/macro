import {
  buildDiffState,
  buildWhoMap,
  diffStates,
  serializedEditorStateToMarkdown,
} from '@lexical-core';
import { useDocumentPeersQuery } from '@queries/sync/document-peers';
import type { HistorySession, HistoryVersionId } from '@service-sync/client';
import { syncServiceClient } from '@service-sync/client';
import { tryMacroId, useDisplayName } from '@core/user';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createContext,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  mapArray,
  useContext,
} from 'solid-js';
import { sessionize } from './sessionize';
import { buildTimestampIndex } from './timestampIndex';
import { userColor, userLabel } from './utils';

export type HistoryUser = {
  userId: string;
  displayName: () => string;
  color: string;
};

type HistoryContextValue = {
  isOpen: Accessor<boolean>;
  selectedAt: Accessor<Date | null>;
  isLive: Accessor<boolean>;
  open: () => void;
  enter: (at?: Date) => void;
  exit: () => void;
  sessions: Accessor<readonly HistorySession[]>;
  loading: { sessions: Accessor<boolean>; doc: Accessor<boolean> };
  checkoutAt: (ms: number) => SerializedEditorState | null;
  versionIdAt: (ms: number) => HistoryVersionId | null;
  diff: {
    session: Accessor<HistorySession | null>;
    previewState: Accessor<SerializedEditorState | null>;
    view: (session: HistorySession) => void;
    clear: () => void;
  };
  userByPeer: (peerId: string) => HistoryUser;
  userById: (userId: string) => HistoryUser;
};

const HistoryContext = createContext<HistoryContextValue>();

export function HistoryProvider(props: {
  documentId: Accessor<string>;
  children: JSX.Element;
}) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedAt, setSelectedAt] = createSignal<Date | null>(null);
  const [isLive, setIsLive] = createSignal(true);
  const [diffSession, setDiffSession] = createSignal<HistorySession | null>(
    null
  );

  const open = () => setIsOpen(true);

  const enter = (at?: Date) => {
    setDiffSession(null);
    setSelectedAt(at ?? null);
    setIsLive(at === undefined);
    setIsOpen(true);
  };

  const exit = () => {
    setIsOpen(false);
    setSelectedAt(null);
    setIsLive(true);
    setDiffSession(null);
  };

  // Park the scrubber at the session's end and flip into diff mode. The overlay
  // renders `diffPreviewState` while a diff is active.
  const viewSessionDiff = (session: HistorySession) => {
    setSelectedAt(new Date(session.endMs));
    setIsLive(false);
    setIsOpen(true);
    setDiffSession(session);

    // DEBUG: dump this session's before/after markdown and computed diffs.
    const index = historyIndex();
    const before = index?.checkoutAt(session.startMs - 1) ?? null;
    const after = index?.checkoutAt(session.endMs) ?? null;
    const beforeMd = before ? serializedEditorStateToMarkdown(before) : null;
    const afterMd = after ? serializedEditorStateToMarkdown(after) : null;
    console.group(
      `[history] session ${session.userId} ${new Date(
        session.startMs
      ).toISOString()} → ${new Date(session.endMs).toISOString()} (${
        session.count
      } changes)`
    );
    console.log('before markdown:\n', beforeMd);
    console.log('after markdown:\n', afterMd);
    console.log('markdown changed:', beforeMd !== afterMd);
    console.log(
      'diffs:',
      before && after ? diffStates(before, after) : '(missing state)'
    );
    console.groupEnd();
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
  const peerMap = useDocumentPeersQuery(props.documentId);

  // One stable useDisplayName per unique userId — batched into a single fetch.
  const uniqueUserIds = createMemo(() =>
    peerMap.data ? [...new Set(peerMap.data.values())] : []
  );
  const userEntries = mapArray(uniqueUserIds, (userId) => {
    const [displayName] = useDisplayName(tryMacroId(userId), {
      emailFallback: 'local-part',
    });
    return { userId, displayName, color: userColor(userId) };
  });
  const userById = (userId: string): HistoryUser =>
    userEntries().find((e) => e.userId === userId) ?? {
      userId,
      displayName: () => userLabel(userId),
      color: userColor(userId),
    };
  const userByPeer = (peerId: string): HistoryUser =>
    userById(peerMap.data?.get(peerId) ?? 'unknown');

  const historyIndex = createMemo(() => {
    const doc = historyDoc();
    return doc ? buildTimestampIndex(doc) : null;
  });

  // Sessions derived locally from the oplog: one edit event per change, grouped
  // per user. Sessions with no visible change — the start and end states render
  // to identical markdown (formatting-only, block reorders, metadata, or
  // typed-then-deleted edits) — are dropped so only real edits surface.
  const sessions = createMemo<readonly HistorySession[]>(() => {
    const doc = historyDoc();
    const peers = peerMap.data;
    if (!doc || !peers) return [];

    const events: { userId: string; tMs: number }[] = [];
    for (const [peer, changes] of doc.getAllChanges()) {
      const userId = peers.get(peer) ?? 'unknown';
      for (const change of changes) {
        events.push({ userId, tMs: change.timestamp * 1000 });
      }
    }

    const index = historyIndex();
    if (!index) return sessionize(events);
    return sessionize(events).filter((s) => {
      const before = index.checkoutAt(s.startMs - 1);
      const after = index.checkoutAt(s.endMs);
      // Can't compute both states (edge frontiers) — keep rather than hide.
      if (!before || !after) return true;
      return (
        serializedEditorStateToMarkdown(before) !==
        serializedEditorStateToMarkdown(after)
      );
    });
  });

  const checkoutAt = (ms: number): SerializedEditorState | null =>
    historyIndex()?.checkoutAt(ms) ?? null;

  const versionIdAt = (ms: number): HistoryVersionId | null =>
    historyIndex()?.versionIdAt(ms) ?? null;

  // Diff a session: the state just before its first edit vs the state at its end,
  // paired by node id. Each changed block is attributed to whoever last edited it
  // (via buildWhoMap over the loro op history), falling back to the session author.
  const diffPreviewState = createMemo<SerializedEditorState | null>(() => {
    const session = diffSession();
    if (!session) return null;
    const before = checkoutAt(session.startMs - 1);
    const after = checkoutAt(session.endMs);
    if (!before || !after) return null;
    // Checking out an arbitrary frontier can yield a structurally-incomplete
    // lexical state (empty root, or a node whose `type` isn't set yet — the same
    // states that break the plain scrubbing preview). Skip and degrade to "no
    // diff" rather than crashing the overlay.
    if (!before.root.children?.length || !after.root.children?.length)
      return null;
    try {
      const doc = historyDoc();
      const peers = peerMap.data;
      const whoMap =
        doc && peers
          ? buildWhoMap(doc, (peer) => peers.get(peer) ?? 'unknown')
          : new Map<string, string>();
      const diffs = diffStates(
        before,
        after,
        (id) => whoMap.get(id) ?? session.userId
      );
      return buildDiffState(before, diffs);
    } catch (error) {
      console.warn('[history] could not build the session diff', error);
      return null;
    }
  });

  const value: HistoryContextValue = {
    isOpen,
    selectedAt,
    isLive,
    open,
    enter,
    exit,
    sessions,
    loading: {
      sessions: () => historyDoc() == null || peerMap.isPending,
      doc: () => historyDoc() == null,
    },
    checkoutAt,
    versionIdAt,
    userByPeer,
    userById,
    diff: {
      session: diffSession,
      previewState: diffPreviewState,
      view: viewSessionDiff,
      clear: () => {
        setDiffSession(null);
        setSelectedAt(null);
        setIsLive(true);
      },
    },
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
