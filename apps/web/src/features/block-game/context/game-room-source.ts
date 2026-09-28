import type { LoroDoc } from 'loro-crdt';
import type { Accessor } from 'solid-js';
import type { GamePresence } from '../core/presence';

export type { GamePresence };

export type GameConnectionStatus = 'connecting' | 'connected' | 'offline';

export type GamePeer = {
  /** One client of the room; a person with two tabs open has two. */
  peerId: string;
  userId: string | undefined;
  color: string;
  presence: GamePresence;
};

/** The room owns game rules; its host owns transport and persistence. */
export type GameRoomSource = {
  /** This client's presence id, comparable with `GamePeer.peerId`. */
  peerId: string;
  doc: Accessor<LoroDoc | undefined>;
  ready: Accessor<boolean>;
  error: Accessor<string | undefined>;
  status: Accessor<GameConnectionStatus>;
  /** Other people in the room right now. */
  peers: Accessor<GamePeer[]>;
  setPresence: (presence: GamePresence | undefined) => void;
};
