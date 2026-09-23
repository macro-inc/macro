import { createEffect, createMemo, createSignal } from 'solid-js';
import type {
  MeetingNavigationCapabilities,
  MeetingRouteEntry,
} from '../context/meeting-navigation';

export function createMeetingNavigation(
  capabilities: MeetingNavigationCapabilities
) {
  const entry = createMemo<MeetingRouteEntry>((previous) => {
    const target = capabilities.target();
    if (target.kind === 'new') {
      return previous?.kind === 'new' && !previous.shareToken
        ? previous
        : { kind: 'new' };
    }
    if (target.kind === 'unavailable') return { kind: 'unavailable' };
    if (
      previous?.kind !== 'unavailable' &&
      previous?.shareToken === target.shareToken
    )
      return previous;
    return { kind: 'existing', shareToken: target.shareToken };
  });
  const [connection, setConnection] = createSignal<{
    owner: MeetingRouteEntry;
    connected: boolean;
    shareToken: string;
  }>();
  let leavingOwner: MeetingRouteEntry | undefined;

  function setCallState(
    owner: MeetingRouteEntry,
    connected: boolean,
    shareToken: string
  ) {
    if (
      entry() !== owner ||
      owner === leavingOwner ||
      owner.kind === 'unavailable' ||
      !shareToken
    )
      return;
    // Associate the newly created token with its existing draft/session owner
    // before replacing the route. This is identity bookkeeping, not UI state.
    if (owner.kind === 'new') owner.shareToken = shareToken;
    setConnection({ owner, connected, shareToken });
  }

  function leave(owner: MeetingRouteEntry) {
    if (
      entry() !== owner ||
      owner === leavingOwner ||
      owner.kind === 'unavailable'
    )
      return;
    leavingOwner = owner;
    // Cleanup may report a disconnected session before the router unmounts it.
    // Explicit Leave returns to Macro; only unexpected disconnects show setup.
    setConnection(undefined);
    capabilities.returnToApp();
  }

  // Synchronize the external router with the owned session, including Back and
  // a direct visit to an active URL. URL shape never starts a connection.
  createEffect(() => {
    const current = connection();
    const owner = entry();
    const target = capabilities.target();
    if (!current || current.owner !== owner) return;
    const kind = current.connected ? 'active' : 'setup';
    if (target.kind === kind && target.shareToken === current.shareToken)
      return;
    capabilities.replace({ kind, shareToken: current.shareToken });
  });

  return { entry, setCallState, leave };
}
