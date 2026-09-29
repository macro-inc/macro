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
    // Keep the draft owner when its new token replaces the setup URL.
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

  // Reflect session state in the URL; visiting an active URL does not join.
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
