/**
 * Sessions that exist on screen before they exist on the server.
 *
 * `POST /agent-sessions` does not answer until its Daytona sandbox is booted,
 * cloned and answering — minutes, not milliseconds. Waiting on that before
 * opening anything means staring at a spinner for the whole provision, so the
 * block opens immediately against a placeholder id minted here, and adopts
 * the real one when the create lands.
 *
 * The registry is module-level on purpose: the create is in flight before any
 * block mounts, and must survive the mount either way round — resolving
 * before the block is on screen is normal, not a race.
 *
 * Everything downstream of the block reads its session id as
 * `Accessor<string | undefined>`, so "not created yet" is the same absence
 * they already handle while the GET is in flight.
 */

import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type Accessor, createSignal } from 'solid-js';

/**
 * Placeholder ids are prefixed so a session id can never be mistaken for one:
 * real ids are UUIDs.
 */
const PLACEHOLDER_PREFIX = 'pending-';

export type PendingSession = {
  /** The real session id, once the create resolves. */
  sessionId: Accessor<string | undefined>;
  /** The create failed — this block has nothing to become. */
  failed: Accessor<boolean>;
};

const pending = new Map<string, PendingSession>();

/** Whether `id` is a placeholder this module minted rather than a session. */
export function isPlaceholderSessionId(id: string): boolean {
  return id.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Start creating a managed session and return the placeholder to open a block
 * against right now. The POST runs unattended; nothing awaits it.
 */
export function startPendingSession(): string {
  const placeholder = `${PLACEHOLDER_PREFIX}${crypto.randomUUID()}`;
  const [sessionId, setSessionId] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  pending.set(placeholder, { sessionId, failed });

  void agentHarnessServiceClient
    .create({})
    .then((result) => {
      if (result.isErr()) {
        setFailed(true);
        return;
      }
      setSessionId(result.value.session.id);
    })
    .catch(() => setFailed(true));

  return placeholder;
}

/**
 * The pending session behind a placeholder, or undefined when there is none —
 * a placeholder URL reloaded in a new tab, whose create belonged to the tab
 * that is gone.
 */
export function pendingSession(
  placeholder: string
): PendingSession | undefined {
  return pending.get(placeholder);
}

/**
 * Drop a resolved placeholder. Called once the block has adopted the real id,
 * so the map does not grow for the life of the tab.
 */
export function forgetPendingSession(placeholder: string): void {
  pending.delete(placeholder);
}
