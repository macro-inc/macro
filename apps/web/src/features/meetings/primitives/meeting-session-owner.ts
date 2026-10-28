import { createEffect, createRoot, getOwner, onCleanup } from 'solid-js';
import type { MeetingSessionCapabilities } from '../context/meeting-session';
import { createMeetingSession } from './meeting-session';

type OwnedSession = {
  capabilities: MeetingSessionCapabilities;
  session: ReturnType<typeof createMeetingSession>;
  dispose: () => void;
  attached: boolean;
};

/** A disposable session root belongs to the provider, not the meeting route. */
export function createMeetingSessionOwner() {
  const owner = getOwner();
  const sessions = new Set<OwnedSession>();

  function remove(entry: OwnedSession) {
    sessions.delete(entry);
    entry.dispose();
  }

  function detach(entry: OwnedSession) {
    if (!entry.attached) return;
    entry.attached = false;
    const callId = entry.session.joinedCallId();
    if (
      callId &&
      entry.capabilities.isInCall() &&
      entry.capabilities.activeCallId() === callId
    )
      return;
    remove(entry);
  }

  function acquire(capabilities: MeetingSessionCapabilities) {
    const existing = [...sessions].find(
      (entry) =>
        !entry.attached &&
        !!capabilities.shareToken() &&
        entry.capabilities.shareToken() === capabilities.shareToken() &&
        entry.session.joinedCallId() === capabilities.activeCallId() &&
        capabilities.isInCall()
    );
    if (existing) {
      existing.attached = true;
      return { session: existing.session, detach: () => detach(existing) };
    }
    let entry!: OwnedSession;
    createRoot((dispose) => {
      const session = createMeetingSession(capabilities);
      entry = { capabilities, session, dispose, attached: true };
      createEffect(() => {
        const callId = session.joinedCallId();
        const connected = capabilities.isInCall();
        const activeId = capabilities.activeCallId();
        if (!entry.attached && callId && (!connected || activeId !== callId))
          remove(entry);
      });
    }, owner);
    sessions.add(entry);
    return { session: entry.session, detach: () => detach(entry) };
  }

  onCleanup(() => {
    for (const entry of sessions) entry.dispose();
    sessions.clear();
  });
  return { acquire };
}
