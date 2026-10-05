import { Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup } from 'solid-js';
import type {
  MeetingCredentials,
  MeetingLocalTracks,
  MeetingMediaPreferences,
  MeetingSessionCapabilities,
} from '../context/meeting-session';

type IssuedMeetingSession = {
  credentials: MeetingCredentials;
  shareToken: string;
};

export function createMeetingSession(capabilities: MeetingSessionCapabilities) {
  const [joining, setJoining] = createSignal(false);
  const [joinedCallId, setJoinedCallId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [hasLeft, setHasLeft] = createSignal(false);
  let issuedSession: IssuedMeetingSession | undefined;
  let activeAttempt: AbortController | undefined;
  let generation = 0;
  let disposed = false;

  async function release(session: IssuedMeetingSession) {
    try {
      await capabilities.release(session.shareToken, session.credentials.token);
    } catch (cause) {
      // LiveKit's participant-left webhook also cleans up the session.
      console.error('Failed to release meeting participant', cause);
    }
  }

  /** Handed-off tracks go to `connect` or are stopped; they never leak. */
  async function join(
    displayName: string | undefined,
    { localTracks, ...preferences }: MeetingMediaPreferences
  ) {
    let unclaimed = localTracks;
    try {
      await attemptJoin(displayName, preferences, () => {
        const claimed = unclaimed;
        unclaimed = undefined;
        return claimed;
      });
    } finally {
      unclaimed?.microphone?.stop();
      unclaimed?.camera?.stop();
    }
  }

  async function attemptJoin(
    displayName: string | undefined,
    preferences: Omit<MeetingMediaPreferences, 'localTracks'>,
    claimLocalTracks: () => MeetingLocalTracks | undefined
  ) {
    if (joining() || disposed) return;
    if (issuedSession && capabilities.isInCall()) {
      setError('Leave your current call before joining this one.');
      return;
    }
    if (displayName !== undefined && !displayName.trim()) {
      setError('Enter your name to join the call.');
      return;
    }
    const attempt = ++generation;
    activeAttempt?.abort();
    const controller = new AbortController();
    activeAttempt = controller;
    // Wait across route owners: late token cleanup must finish before reusing
    // the same RTC identity.
    const attemptLifecycle = capabilities.lifecycle.begin();
    setJoining(true);
    setError(undefined);
    setHasLeft(false);
    setJoinedCallId(undefined);
    const previousSession = issuedSession;
    issuedSession = undefined;
    let issued: IssuedMeetingSession | undefined;
    const joinTrace = Telemetry.span('meeting.join');
    joinTrace.setAttr(
      'meeting.join.kind',
      capabilities.prepare ? 'create' : 'join'
    );
    joinTrace.setAttr('meeting.join.guest', displayName !== undefined);
    joinTrace.setAttr('meeting.join.microphone', preferences.microphoneEnabled);
    joinTrace.setAttr('meeting.join.camera', preferences.cameraEnabled);
    joinTrace.setAttr('meeting.join.outcome', 'cancelled');
    try {
      await joinTrace.span('meeting.join.previous_session', async () => {
        await attemptLifecycle.previous;
        if (previousSession) await release(previousSession);
      });
      if (disposed || attempt !== generation) return;
      // A previous owner may still have been disconnecting when Join was
      // clicked. Check the shared call state after its cleanup has finished.
      if (capabilities.isInCall()) {
        joinTrace.setAttr('meeting.join.outcome', 'already_in_call');
        setError('Leave your current call before joining this one.');
        return;
      }
      const prepare = capabilities.prepare;
      if (prepare) {
        await joinTrace.span('meeting.join.create', () =>
          prepare(controller.signal)
        );
        if (disposed || attempt !== generation) return;
      }
      const shareToken = capabilities.shareToken();
      issued = {
        credentials: await joinTrace.span('meeting.join.credentials', () =>
          capabilities.join(displayName?.trim())
        ),
        shareToken,
      };
      if (disposed || attempt !== generation) {
        await release(issued);
        return;
      }
      issuedSession = issued;
      joinTrace.setAttr('call.id', issued.credentials.callId);
      const localTracks = claimLocalTracks();
      const credentials = issued.credentials;
      await joinTrace.span('meeting.join.connect', () =>
        capabilities.connect(
          credentials,
          localTracks ? { ...preferences, localTracks } : preferences
        )
      );
      if (disposed || attempt !== generation) return;
      setJoinedCallId(issued.credentials.callId);
      joinTrace.setAttr('meeting.join.outcome', 'connected');
    } catch (cause) {
      // Provider errors may include credentials or a capability URL.
      if (!disposed && attempt === generation) {
        joinTrace.error('Meeting join failed');
        joinTrace.setAttr('meeting.join.outcome', 'failed');
      }
      if (issued && issuedSession === issued) {
        issuedSession = undefined;
        try {
          if (capabilities.activeCallId() === issued.credentials.callId) {
            await capabilities.disconnect();
          }
        } catch (disconnectError) {
          console.error(
            'Failed to clean up meeting connection',
            disconnectError
          );
        } finally {
          await release(issued);
        }
      }
      if (disposed || attempt !== generation) return;
      issuedSession = undefined;
      setError('Could not join the call. Check your connection and try again.');
      console.error('Failed to join meeting', cause);
    } finally {
      joinTrace.end();
      // Keep the signal abortable for connected actions such as retrying invites.
      // A failed attempt has no session left that can own those actions.
      if (
        activeAttempt === controller &&
        (!issued || issuedSession !== issued)
      ) {
        controller.abort();
        activeAttempt = undefined;
      }
      attemptLifecycle.complete();
      if (!disposed && attempt === generation) setJoining(false);
    }
  }

  async function leave() {
    generation += 1;
    activeAttempt?.abort();
    activeAttempt = undefined;
    const session = issuedSession;
    issuedSession = undefined;
    const cleanupLifecycle = capabilities.lifecycle.begin();
    if (!disposed) {
      setJoining(false);
      setJoinedCallId(undefined);
      setHasLeft(true);
    }
    // Start the keepalive release before awaiting local RTC disconnection:
    // navigation or tab closure must not strand server-side participation.
    const releasing = session ? release(session) : undefined;
    try {
      // Cancellation must not wait for the token request it is cancelling.
      // The shared lifecycle still retains that attempt independently.
      if (!session) return;
      if (
        capabilities.activeCallId() === null ||
        capabilities.activeCallId() === session.credentials.callId
      ) {
        await capabilities.disconnect();
      }
    } catch (cause) {
      console.error('Failed to disconnect meeting', cause);
    } finally {
      try {
        await releasing;
      } finally {
        cleanupLifecycle.complete();
      }
    }
  }

  onCleanup(() => {
    disposed = true;
    void leave();
  });

  return { join, leave, joining, joinedCallId, error, hasLeft };
}
