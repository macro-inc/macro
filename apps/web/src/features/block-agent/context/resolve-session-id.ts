/**
 * A block's session id, which may not exist yet.
 *
 * The block mounts with whatever id the split gave it. Usually that is a
 * session to load; for a just-created one it is an id whose create is still
 * on the wire (`pending-session.ts`). This resolves the two into the one
 * shape the block consumes: an id that is absent until the session exists,
 * plus the facts the block chrome needs to explain the wait.
 */

import { type Accessor, createMemo } from 'solid-js';
import { pendingSession } from './pending-session';

export type ResolvedSessionId = {
  /** The session id; absent while its create is still in flight. */
  sessionId: Accessor<string | undefined>;
  /** This block is waiting on a create it started. */
  pending: Accessor<boolean>;
  /** The create failed. */
  failed: Accessor<boolean>;
  error: Accessor<string | undefined>;
  /** The first prompt of a create this block started, to show as sent while
   *  the create is still on the wire. */
  pendingPrompt: Accessor<string | undefined>;
};

export function resolveSessionId(blockId: Accessor<string>): ResolvedSessionId {
  // The create in flight for this id, or undefined for an id that is simply
  // a session to load. Read once per id: a create that settles is forgotten
  // by the surface that opened it, and by then `sessionId` is the id itself.
  const entry = createMemo(() => pendingSession(blockId()));

  const sessionId = () => {
    const session = entry();
    if (session === undefined) return blockId();
    return session.sessionId();
  };

  return {
    sessionId,
    pending: () =>
      entry() !== undefined &&
      !entry()?.failed() &&
      entry()?.sessionId() === undefined,
    failed: () => entry()?.failed() ?? false,
    error: () => entry()?.error(),
    pendingPrompt: () => entry()?.prompt,
  };
}
