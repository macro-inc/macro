import { createSignal } from 'solid-js';
import type {
  DraftPersistFailureCode,
  PersistedEmailIdentity,
} from '../context/compose-capabilities';

/**
 * What the composer knows about its draft's server row.
 *
 * `handle`: ids the composer minted; a save under them was queued (or is in
 * flight) and the server may not know them yet. `server`: ids a committed
 * save (or a fetched draft) confirmed, so REST-only actions — send,
 * schedule, attachment uploads — can resolve them.
 */
export type DraftIdentity =
  | { kind: 'none' }
  | { kind: 'handle'; draftId: string; threadId?: string }
  | { kind: 'server'; draftId: string; threadId?: string };

/**
 * Whether edits may autosave. A deterministic server rejection latches the
 * policy: the content stays in the editor, but the same save must never be
 * replayed on its own — a doomed save retried forever would block every
 * queued mutation in the app behind it.
 */
export type DraftSavePolicy =
  | { kind: 'autosaving' }
  | { kind: 'latched'; code: DraftPersistFailureCode };

export type DraftSessionState = {
  identity: DraftIdentity;
  policy: DraftSavePolicy;
  /**
   * Bumped whenever the composer drops its draft (send, discard, emptied,
   * already sent elsewhere). A continuation that captured an older epoch
   * belongs to a draft the user already left behind and must not adopt ids,
   * upload, refetch, or latch — see `isStale`.
   */
  epoch: number;
};

export type DraftSessionEvent =
  /** Mounted on (or restored to) a draft the server already holds. */
  | { type: 'seeded'; draftId?: string | null; threadId?: string | null }
  /** Client handles minted before the first dispatch of a new draft. */
  | { type: 'minted'; draftId: string; threadId?: string }
  /** A save resolved; `epoch` is the value captured before dispatch. */
  | {
      type: 'saved';
      epoch: number;
      identity: Pick<PersistedEmailIdentity, 'draftId' | 'threadId'> & {
        persistence?: PersistedEmailIdentity['persistence'];
      };
    }
  /** The server rejected a save or delete deterministically. */
  | { type: 'rejected'; epoch: number; code: DraftPersistFailureCode }
  /** The draft has no content left; its row was (or is being) deleted. */
  | { type: 'emptied' }
  /** The composer dropped its draft: sent, discarded, or superseded. */
  | { type: 'reset' };

const FRESH: Omit<DraftSessionState, 'epoch'> = {
  identity: { kind: 'none' },
  policy: { kind: 'autosaving' },
};

export function initialDraftSession(seed?: {
  draftId?: string | null;
  threadId?: string | null;
}): DraftSessionState {
  return reduceDraftSession(
    { ...FRESH, epoch: 0 },
    { type: 'seeded', ...seed }
  );
}

/** Pure transition; every rule the composers rely on lives here. */
export function reduceDraftSession(
  state: DraftSessionState,
  event: DraftSessionEvent
): DraftSessionState {
  switch (event.type) {
    case 'seeded':
      return {
        ...state,
        identity: event.draftId
          ? {
              kind: 'server',
              draftId: event.draftId,
              threadId: event.threadId ?? undefined,
            }
          : { kind: 'none' },
        policy: { kind: 'autosaving' },
      };
    case 'minted':
      if (state.identity.kind !== 'none') return state;
      return {
        ...state,
        identity: {
          kind: 'handle',
          draftId: event.draftId,
          threadId: event.threadId,
        },
      };
    case 'saved': {
      if (event.epoch !== state.epoch) return state;
      const draftId = event.identity.draftId ?? currentDraftId(state);
      if (!draftId) return state;
      const threadId = event.identity.threadId ?? currentThreadId(state);
      if (event.identity.persistence === 'queued') {
        // Durable locally under the caller's handles; the server has not
        // confirmed them. A server id stays a server id.
        return state.identity.kind === 'server'
          ? state
          : { ...state, identity: { kind: 'handle', draftId, threadId } };
      }
      return { ...state, identity: { kind: 'server', draftId, threadId } };
    }
    case 'rejected':
      if (event.epoch !== state.epoch) return state;
      if (event.code === 'DRAFT_ALREADY_SENT') {
        // Sent from another device: the server outcome supersedes the
        // local draft, which the composer drops.
        return { ...FRESH, epoch: state.epoch + 1 };
      }
      return { ...state, policy: { kind: 'latched', code: event.code } };
    case 'emptied':
    case 'reset':
      // A fresh draft: nothing in flight belongs to it, and a rejection
      // latched against the previous content must not keep it from saving.
      return { ...FRESH, epoch: state.epoch + 1 };
  }
}

function currentDraftId(state: DraftSessionState) {
  return state.identity.kind === 'none' ? undefined : state.identity.draftId;
}
function currentThreadId(state: DraftSessionState) {
  return state.identity.kind === 'none' ? undefined : state.identity.threadId;
}

/** Reactive holder for one composer's draft session. */
export function createDraftSession(seed?: {
  draftId?: string | null;
  threadId?: string | null;
}) {
  const [state, setState] = createSignal(initialDraftSession(seed));
  return {
    state,
    dispatch(event: DraftSessionEvent) {
      setState((current) => reduceDraftSession(current, event));
    },
    epoch: () => state().epoch,
    /** Whether `epoch`, captured before an await, predates a reset. */
    isStale: (epoch: number) => epoch !== state().epoch,
    identity: () => state().identity,
    draftId: () => currentDraftId(state()),
    threadId: () => currentThreadId(state()),
    /** REST-only actions can resolve the draft's ids. */
    restSendable: () => state().identity.kind === 'server',
    autosaveAllowed: () => state().policy.kind === 'autosaving',
  };
}
