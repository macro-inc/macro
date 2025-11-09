import { getRandomPaletteColor } from '@core/component/LexicalMarkdown/collaboration/color';
import {
  EphemeralStore,
  type EphemeralStoreEvent,
  type PeerID,
  type Value,
} from 'loro-crdt';
import { type Accessor, createSignal, untrack } from 'solid-js';
import type { RawUpdate } from './shared';

/** The default timeout for a user's awareness is 10 seconds */
const DEFAULT_AWARENESS_TIMEOUT = 10_000;

export type PeerAwarenessRaw<EncodedSelection extends Value = Value> = {
  user: { userId: string | undefined; color: string; peerId: PeerID };
  selection: EncodedSelection | undefined;
};

export type PeerAwareness<DecodedSelection> = {
  user: { userId: string | undefined; color: string; peerId: PeerID };
  selection: DecodedSelection | undefined;
};

/**
 * A codec for encoding and decoding selections
 *
 * Selections require encoding / decoding, because they likely contain a [LoroCursor]
 * Which is a wasm ptr, which is not structured clonable.
 *
 * To transmit LoroCursor over the wire, we need to use the LoroCursor.encode() method
 *
 * The `encode` method on the codec, is responsible for encoding all cursors in the selection
 *
 * @typeParam DecodedSelection - The decoded selection type
 * @typeParam EncodedSelection - The encoded selection type, should be Structured Clonable
 */
export type SelectionCodec<DecodedSelection, EncodedSelection extends Value> = {
  /** Encodes a decoded selection into an encoded selection
   *
   * @param selection - The decoded selection
   * @returns The encoded selection
   * */
  encode: (selection: DecodedSelection) => EncodedSelection;
  /** Decodes an encoded selection into a decoded selection
   *
   * @param serialized - The encoded selection
   * @returns The decoded selection
   * */
  decode: (encoded: EncodedSelection) => DecodedSelection;
};

export type Awareness<DecodedSelection> = {
  /** Signal containing the decoded local awareness */
  readonly local: Accessor<PeerAwareness<DecodedSelection>>;
  /** Signal containing the all decoded remote awarenesses */
  readonly remote: Accessor<PeerAwareness<DecodedSelection>[]>;
  updateRemoteAwareness: (
    peerId: PeerID,
    selection: DecodedSelection | undefined
  ) => void;
  updateLocalAwareness: (selection: DecodedSelection | undefined) => void;
  /** Imports remote awareness updates
   *
   * @param update - The update to import
   * */
  importRemoteAwareness: (update: RawUpdate) => void;
  /** Returns the encoded local awareness as a [RawUpdate] */
  getEncodedLocalAwareness: () => RawUpdate;
};

/** Creates a new awareness object
 * that keeps track of each peer's "awareness" within the document
 * The awareness is defined by a selection, which stores arbitrary information
 * about the user's cursor position, selection, etc.
 *
 * @param peerId - The peer ID of the awareness
 * @param userId - The user ID of the awareness
 * @param selectionCodec - The codec to use for encoding and decoding selections
 * @param options - Optional options for the awareness
 * @returns The new awareness object
 */
export function createAwareness<
  EncodedSelection extends Value,
  DecodedSelection,
>(
  peerId: PeerID,
  userId: string | undefined,
  selectionCodec: SelectionCodec<DecodedSelection, EncodedSelection>,
  options?: {
    timeout?: number;
  }
): Awareness<DecodedSelection> {
  // Initialize the ephemeral store
  // By default, each peer awareness will timeout after 5 seconds of inactivity
  const store = new EphemeralStore<
    Record<string, PeerAwarenessRaw<EncodedSelection> | undefined>
  >(options?.timeout ?? DEFAULT_AWARENESS_TIMEOUT);

  // Initialize user awareness with a random color
  const color = getRandomPaletteColor();

  // Initialize the local peer's awareness
  const initialLocalPeerAwarenessRaw: PeerAwarenessRaw<EncodedSelection> = {
    user: {
      userId,
      color,
      peerId,
    },
    selection: undefined,
  };

  store.set(peerId, initialLocalPeerAwarenessRaw);

  // The local signal contains the deserialized version
  const [local, setLocal] = createSignal<PeerAwareness<DecodedSelection>>({
    user: initialLocalPeerAwarenessRaw.user,
    selection: undefined,
  });

  const [remote, setRemote] = createSignal<PeerAwareness<DecodedSelection>[]>(
    []
  );

  const updateRemoteAwarenessSignal = () => {
    const allStates = store.getAllStates();

    const remoteAwareness: PeerAwareness<DecodedSelection>[] = Object.entries(
      allStates
    )
      .filter(([id, awareness]) => {
        return (
          peerId !== id && !!awareness && awareness?.selection !== undefined
        );
      })
      .map(([id, awareness]) => {
        return [id, decodeAwareness(awareness, selectionCodec)];
      })
      .map(([_, awareness]) => awareness as PeerAwareness<DecodedSelection>);

    setRemote(remoteAwareness);
  };

  /** Update the local awareness signal with the vaue from the store */
  const updateLocalAwarenessSignal = () => {
    const awareness = store.get(peerId);
    const decodedAwareness = decodeAwareness(awareness, selectionCodec);
    if (decodedAwareness) {
      setLocal(decodedAwareness);
    }
  };

  const updateAwarenessSignals = (update: EphemeralStoreEvent) => {
    const changes = [...update.added, ...update.removed, ...update.updated];
    if (changes.length === 0) return;

    if (update.by === 'local' && changes.includes(peerId)) {
      updateLocalAwarenessSignal();
      return;
    } else {
      updateRemoteAwarenessSignal();
      return;
    }
  };

  const updatePeerAwareness = (
    id: PeerID,
    selection: DecodedSelection | undefined
  ) => {
    if (selection === undefined) {
      store.set(id, undefined);
      return;
    }

    const currAwareness = untrack(local);
    const newAwareness = encodeAwareness(
      {
        user: currAwareness.user,
        selection: selection,
      },
      selectionCodec
    );
    store.set(id, newAwareness);
  };

  const updateLocalAwareness = (selection: DecodedSelection | undefined) => {
    updatePeerAwareness(peerId, selection);
  };

  const updateRemoteAwareness = (
    id: PeerID,
    selection: DecodedSelection | undefined
  ) => {
    if (id === peerId) {
      return;
    }
    updatePeerAwareness(id, selection);
  };

  const importRemoteAwareness = (update: RawUpdate) => {
    store.apply(update);
  };

  const getEncodedLocalAwareness = () => {
    return store.encode(peerId);
  };

  // Listen for changes to the ephemeral store
  store.subscribe((update) => {
    // HACK: loro-crdt has a bug with [`EphemeralStore.subscribe`] which breaks
    // recursive aliasing. This is a workaround for now.
    queueMicrotask(() => {
      updateAwarenessSignals(update);
    });
  });

  return {
    local,
    remote,
    updateLocalAwareness,
    updateRemoteAwareness,
    importRemoteAwareness,
    getEncodedLocalAwareness,
  };
}

/** Decodes an awareness object from a raw update */
function decodeAwareness<EncodedSelection extends Value, DecodedSelection>(
  awareness: PeerAwarenessRaw<EncodedSelection> | undefined,
  codec: SelectionCodec<DecodedSelection, EncodedSelection>
): PeerAwareness<DecodedSelection> | undefined {
  if (!awareness) {
    return undefined;
  }

  if (!awareness.selection) {
    return {
      user: awareness.user,
      selection: undefined,
    };
  }
  const encodedSelection = awareness.selection;

  return {
    user: awareness.user,
    selection: codec.decode(encodedSelection),
  };
}

/** Encodes an awareness object into a decoded awareness to be stored in the store
 *
 * @param awareness - The awareness object to encode
 * @param codec - The codec to use for encoding
 * @returns The encoded awareness
 */
function encodeAwareness<DecodedSelection extends Value>(
  awareness: PeerAwareness<unknown>,
  codec: SelectionCodec<any, DecodedSelection>
) {
  if (!awareness.selection) {
    return {
      user: awareness.user,
      selection: undefined,
    };
  }

  const encodedSelection = codec.encode(awareness.selection);

  return {
    user: awareness.user,
    selection: encodedSelection,
  };
}

/** Checks if an awareness object has a selection */
export function isAwarenessWithSelection<DecodedSelection>(
  awareness: PeerAwareness<DecodedSelection | undefined>
): awareness is PeerAwareness<DecodedSelection> {
  return awareness?.selection !== undefined;
}
