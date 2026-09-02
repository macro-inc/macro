/**
 * A block's session id, which may not exist yet.
 *
 * The block mounts with whatever id the split gave it. Usually that is a real
 * session; for a just-created one it is a placeholder standing in for a create
 * still on the wire (`pending-session.ts`). This resolves the two into the one
 * shape the block consumes: an id that is absent until there is one, plus the
 * two facts the block chrome needs to explain the wait.
 */

import { type Accessor, createMemo } from 'solid-js';
import { isPlaceholderSessionId, pendingSession } from './pending-session';

export type ResolvedSessionId = {
  /** The real session id; absent while a create is still in flight. */
  sessionId: Accessor<string | undefined>;
  /** This block is waiting on a create it started. */
  pending: Accessor<boolean>;
  /** The create failed, or the placeholder has no create behind it. */
  failed: Accessor<boolean>;
};

export function resolveSessionId(blockId: Accessor<string>): ResolvedSessionId {
  const entry = createMemo(() => {
    const id = blockId();
    return isPlaceholderSessionId(id)
      ? (pendingSession(id) ?? null)
      : undefined;
  });

  // `undefined` entry: the block id is already a session. `null`: a
  // placeholder nothing is creating — a reloaded placeholder URL, which can
  // only be an error, never a wait.
  const sessionId = () => {
    const session = entry();
    if (session === undefined) return blockId();
    return session?.sessionId();
  };

  return {
    sessionId,
    pending: () => entry() != null && entry()?.sessionId() === undefined,
    failed: () => entry() === null || (entry()?.failed() ?? false),
  };
}
