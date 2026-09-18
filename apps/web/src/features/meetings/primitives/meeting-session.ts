import { createSignal, onCleanup } from 'solid-js';
import type {
  MeetingCredentials,
  MeetingMediaPreferences,
  MeetingSessionCapabilities,
} from '../context/meeting-session';

export function createMeetingSession(capabilities: MeetingSessionCapabilities) {
  const [joining, setJoining] = createSignal(false);
  const [joinedCallId, setJoinedCallId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [hasLeft, setHasLeft] = createSignal(false);
  let credentials: MeetingCredentials | undefined;
  let generation = 0;
  let disposed = false;
  let previousAttempt: Promise<unknown> = Promise.resolve();

  async function release(session: MeetingCredentials, shareToken: string) {
    try {
      await capabilities.release(shareToken, session.token);
    } catch (cause) {
      // LiveKit's participant-left webhook also cleans up the session.
      console.error('Failed to release meeting participant', cause);
    }
  }

  async function join(
    displayName: string | undefined,
    preferences: MeetingMediaPreferences
  ) {
    if (joining() || disposed) return;
    if (capabilities.isInCall()) {
      setError('Leave your current call before joining this one.');
      return;
    }
    if (displayName !== undefined && !displayName.trim()) {
      setError('Enter your name to join the call.');
      return;
    }
    const attempt = ++generation;
    // A cancelled token request may still create the participant server-side.
    // Finish its release before retrying: authenticated attempts share an RTC
    // identity, so late cleanup must never remove a newer session.
    const waitForPreviousAttempt = previousAttempt;
    let finishAttempt!: () => void;
    previousAttempt = new Promise<void>((resolve) => {
      finishAttempt = resolve;
    });
    const shareToken = capabilities.shareToken();
    setJoining(true);
    setError(undefined);
    setHasLeft(false);
    setJoinedCallId(undefined);
    const previousSession = credentials;
    credentials = undefined;
    let issued: MeetingCredentials | undefined;
    try {
      await waitForPreviousAttempt;
      if (previousSession) await release(previousSession, shareToken);
      if (disposed || attempt !== generation) return;
      issued = await capabilities.join(displayName?.trim());
      if (disposed || attempt !== generation) {
        await release(issued, shareToken);
        return;
      }
      credentials = issued;
      await capabilities.connect(issued, preferences);
      if (disposed || attempt !== generation) return;
      setJoinedCallId(issued.callId);
    } catch (cause) {
      if (issued && credentials === issued) {
        credentials = undefined;
        try {
          if (capabilities.activeCallId() === issued.callId) {
            await capabilities.disconnect();
          }
        } catch (disconnectError) {
          console.error(
            'Failed to clean up meeting connection',
            disconnectError
          );
        } finally {
          await release(issued, shareToken);
        }
      }
      if (disposed || attempt !== generation) return;
      credentials = undefined;
      setError('Could not join the call. Check your connection and try again.');
      console.error('Failed to join meeting', cause);
    } finally {
      finishAttempt();
      if (!disposed && attempt === generation) setJoining(false);
    }
  }

  async function leave() {
    generation += 1;
    const session = credentials;
    credentials = undefined;
    if (!disposed) {
      setJoining(false);
      setJoinedCallId(undefined);
      setHasLeft(true);
    }
    if (!session) return;
    let finishLeave!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishLeave = resolve;
    });
    previousAttempt = Promise.all([previousAttempt, cleanup]);
    try {
      if (
        capabilities.activeCallId() === null ||
        capabilities.activeCallId() === session.callId
      ) {
        await capabilities.disconnect();
      }
    } catch (cause) {
      console.error('Failed to disconnect meeting', cause);
    } finally {
      await release(session, capabilities.shareToken());
      finishLeave();
    }
  }

  onCleanup(() => {
    disposed = true;
    void leave();
  });

  return { join, leave, joining, joinedCallId, error, hasLeft };
}
