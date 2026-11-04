import { Telemetry } from '@macro-inc/observability';
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

  function remove(
    entry: OwnedSession,
    reason: 'detached' | 'disconnected' | 'provider_cleanup'
  ) {
    const span = Telemetry.span('meeting.session.dispose');
    try {
      return span.run(() => {
        const callId = entry.session.joinedCallId();
        if (callId) span.setAttr('call.id', callId);
        span.setAttr('meeting.session.dispose_reason', reason);
        sessions.delete(entry);
        entry.dispose();
      });
    } catch (error) {
      span.error(error);
      throw error;
    } finally {
      span.end();
    }
  }

  function detach(entry: OwnedSession) {
    if (!entry.attached) return;
    const span = Telemetry.span('meeting.session.detach');
    try {
      return span.run(() => {
        entry.attached = false;
        const callId = entry.session.joinedCallId();
        if (callId) span.setAttr('call.id', callId);
        if (
          callId &&
          entry.capabilities.isInCall() &&
          entry.capabilities.activeCallId() === callId
        ) {
          span.setAttr('meeting.session.outcome', 'retained');
          return;
        }
        span.setAttr('meeting.session.outcome', 'disposed');
        remove(entry, 'detached');
      });
    } catch (error) {
      span.error(error);
      throw error;
    } finally {
      span.end();
    }
  }

  function acquire(capabilities: MeetingSessionCapabilities) {
    const span = Telemetry.span('meeting.session.acquire');
    try {
      return span.run(() => {
        const existing = [...sessions].find(
          (entry) =>
            !entry.attached &&
            !!capabilities.shareToken() &&
            entry.capabilities.shareToken() === capabilities.shareToken() &&
            entry.session.joinedCallId() === capabilities.activeCallId() &&
            capabilities.isInCall()
        );
        if (existing) {
          const callId = existing.session.joinedCallId();
          if (callId) span.setAttr('call.id', callId);
          span.setAttr('meeting.session.outcome', 'reused');
          existing.attached = true;
          return { session: existing.session, detach: () => detach(existing) };
        }
        span.setAttr('meeting.session.outcome', 'created');
        let entry!: OwnedSession;
        createRoot((dispose) => {
          const session = createMeetingSession(capabilities);
          entry = { capabilities, session, dispose, attached: true };
          createEffect(() => {
            const callId = session.joinedCallId();
            const connected = capabilities.isInCall();
            const activeId = capabilities.activeCallId();
            if (
              !entry.attached &&
              callId &&
              (!connected || activeId !== callId)
            )
              remove(entry, 'disconnected');
          });
        }, owner);
        sessions.add(entry);
        return { session: entry.session, detach: () => detach(entry) };
      });
    } catch (error) {
      span.error(error);
      throw error;
    } finally {
      span.end();
    }
  }

  onCleanup(() => {
    for (const entry of sessions) remove(entry, 'provider_cleanup');
    sessions.clear();
  });
  return { acquire };
}
