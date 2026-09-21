/**
 * A block's session id, which may not exist yet.
 *
 * The block mounts with whatever id the split gave it. Usually that is a real
 * session; for a just-created one it is a client-minted id standing in for a
 * create still on the wire (`pending-session.ts`). This resolves the two into
 * the one shape the block consumes: an id that is absent until there is one,
 * plus the two facts the block chrome needs to explain the wait.
 */

import { type Accessor, createMemo } from 'solid-js';
import { pendingSession } from './pending-session';

export type ResolvedSessionId = {
  /** The real session id; absent while a create is still in flight. */
  sessionId: Accessor<string | undefined>;
  /** This block is waiting on a create it started. */
  pending: Accessor<boolean>;
  /** The create failed. */
  failed: Accessor<boolean>;
  error: Accessor<string | undefined>;
};

export function resolveSessionId(blockId: Accessor<string>): ResolvedSessionId {
  const entry = createMemo(() => pendingSession(blockId()));

  // No entry: the block id is already a session. An entry: this tab is
  // still creating it, so the id is absent until the POST lands.
  const sessionId = () => {
    const session = entry();
    return session ? session.sessionId() : blockId();
  };

  return {
    sessionId,
    pending: () =>
      entry() != null &&
      !entry()?.failed() &&
      entry()?.sessionId() === undefined,
    failed: () => entry()?.failed() ?? false,
    error: () => entry()?.error(),
  };
}
