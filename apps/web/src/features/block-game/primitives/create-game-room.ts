import type { LoroDoc } from 'loro-crdt';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  GameConnectionStatus,
  GamePeer,
  GamePresence,
  GameRoomSource,
} from '../context/game-room-source';
import type { GameKind } from '../core/catalog';
import {
  appendGameLog,
  ensureGameMeta,
  readGameLog,
  readGameMeta,
} from '../core/game-document';
import type { GameLogEntry } from '../core/game-log';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Log entries as the current user writes them; `by` is filled in. */
export type GameLogAction = DistributiveOmit<GameLogEntry, 'by'>;

export type GameRoom = {
  ready: Accessor<boolean>;
  error: Accessor<string | undefined>;
  connection: Accessor<GameConnectionStatus>;
  /** Undefined until the room records which game it hosts. */
  kind: Accessor<GameKind | undefined>;
  log: Accessor<GameLogEntry[]>;
  /** Changes with every document update, for readers of other containers. */
  revision: Accessor<number>;
  doc: Accessor<LoroDoc | undefined>;
  userId: Accessor<string | undefined>;
  /** Whether the current user may write moves: loaded, signed in, and an editor. */
  canPlay: Accessor<boolean>;
  /** Whether the current user wrote the latest log entry. */
  wroteLatest: Accessor<boolean>;
  /** This client's presence id; other clients appear in `peers`. */
  peerId: string;
  peers: Accessor<GamePeer[]>;
  setPresence: (presence: GamePresence | undefined) => void;
  /** Append an action as the current user; false when they cannot play. */
  append: (action: GameLogAction) => boolean;
  /** Record the room's game when it was created without one. */
  chooseKind: (kind: GameKind) => void;
};

export function createGameRoom(options: {
  source: GameRoomSource;
  userId: Accessor<string | undefined>;
  canEdit: Accessor<boolean>;
  /** The game requested at creation, written once the room is writable. */
  requestedKind: Accessor<GameKind | undefined>;
}): GameRoom {
  const { source } = options;
  // The log only ever grows, so an equal length means equal entries. Updates
  // to other containers, like race progress, then leave replays untouched.
  const [log, setLog] = createSignal<GameLogEntry[]>([], {
    equals: (previous, next) => previous.length === next.length,
  });
  const [kind, setKind] = createSignal<GameKind>();
  const [revision, setRevision] = createSignal(0);

  const refresh = (doc: LoroDoc) => {
    setLog(readGameLog(doc));
    setKind(readGameMeta(doc).kind);
    setRevision((value) => value + 1);
  };

  // Loro is an external imperative system; subscribe once hydration supplies
  // its document. A reconnect can replace the document handle.
  createEffect(
    on(source.doc, (doc) => {
      if (!doc) return;
      const unsubscribe = doc.subscribe(() => refresh(doc));
      refresh(doc);
      onCleanup(unsubscribe);
    })
  );

  const canPlay = () =>
    source.ready() && options.canEdit() && options.userId() !== undefined;

  const chooseKind = (next: GameKind) => {
    const doc = source.doc();
    if (!doc || !canPlay()) return;
    if (ensureGameMeta(doc, next)) refresh(doc);
  };

  // The creator's first open records the game into the backend's blank seed.
  createEffect(
    on(
      () => [canPlay(), kind(), options.requestedKind()] as const,
      ([writable, current, requested]) => {
        if (writable && !current && requested) chooseKind(requested);
      }
    )
  );

  return {
    ready: source.ready,
    error: source.error,
    connection: source.status,
    kind,
    log,
    revision,
    doc: source.doc,
    userId: options.userId,
    canPlay,
    wroteLatest: () => {
      const latest = log().at(-1);
      return latest !== undefined && latest.by === options.userId();
    },
    peerId: source.peerId,
    peers: source.peers,
    setPresence: source.setPresence,
    append: (action) => {
      const doc = source.doc();
      const userId = options.userId();
      if (!doc || !userId || !canPlay()) return false;
      appendGameLog(doc, { ...action, by: userId } as GameLogEntry);
      return true;
    },
    chooseKind,
  };
}
