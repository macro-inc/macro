import { useCallContext } from '@channel/Call/CallContext';
import { CallOverlay } from '@channel/Call/CallOverlay';
import { getMeetingUrl } from '@channel/Call/call-link';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useIsAuthenticated, useUserId } from '@core/context/user';
import { useCallRecordQuery } from '@queries/call/call';
import {
  leaveMeeting,
  useJoinMeetingMutation,
  useMeetingQuery,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import { useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { Show } from 'solid-js';
import type { MeetingPageState } from './context/meeting-session';
import { useMeetingSessionLifecycle } from './context/meeting-session-lifecycle';
import { MeetingPage } from './views/meeting-page';

export function MeetingRouteContent(props: {
  shareToken: string;
  onCallStateChange: (connected: boolean) => void;
  onLeave: () => void;
}) {
  const [search] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const call = useCallContext();
  const lifecycle = useMeetingSessionLifecycle();
  const authenticated = useIsAuthenticated();
  const author = useAuthor();
  const userId = useUserId();
  const meeting = useMeetingQuery(() => props.shareToken);
  const join = useJoinMeetingMutation();
  const update = useUpdateMeetingMutation();
  const record = useCallRecordQuery(() =>
    authenticated() === true ? (call.activeCallId() ?? '') : ''
  );
  const canRename = () =>
    authenticated() === true &&
    meeting.isSuccess &&
    record.isSuccess &&
    record.data.callId === call.activeCallId() &&
    record.data.createdBy === userId();

  async function rename(title: string) {
    if (!canRename() || !meeting.isSuccess)
      throw new Error('Only the call owner can rename this call.');
    await update.mutateAsync({ meetingId: meeting.data.id, title });
  }
  const canShareWithTeam = () => {
    if (!record.isSuccess || record.data.channelId === null) return false;
    const access = record.data.userAccessLevel;
    return access === 'owner' || access === 'edit';
  };

  const source = (): MeetingPageState => {
    if (meeting.isError) return { kind: 'unavailable' };
    if (!meeting.isSuccess) return { kind: 'loading' };
    return { kind: 'ready', ...meeting.data };
  };

  return (
    <MeetingPage
      source={source}
      onCallStateChange={props.onCallStateChange}
      onLeave={props.onLeave}
      mediaAccess={{
        request: (constraints) =>
          navigator.mediaDevices.getUserMedia(constraints),
      }}
      authenticated={authenticated}
      author={author}
      avatar={
        <Show when={authenticated() && userId()} keyed>
          {(id) => (
            <UserIcon id={id} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      }
      startCall={
        authenticated() === true &&
        search.start === 'true' &&
        meeting.isSuccess &&
        !meeting.data.callId
      }
      url={getMeetingUrl(props.shareToken)}
      onCopy={() =>
        navigator.clipboard.writeText(getMeetingUrl(props.shareToken))
      }
      onRename={canRename() ? rename : undefined}
      onSignIn={() => {
        const meetingRoute = `${location.pathname}${location.search}`;
        navigate(`/login?redirect=${encodeURIComponent(meetingRoute)}`);
      }}
      session={{
        lifecycle,
        shareToken: () => props.shareToken,
        isInCall: call.isInCall,
        activeCallId: call.activeCallId,
        join: (displayName) =>
          join.mutateAsync({ shareToken: props.shareToken, displayName }),
        release: leaveMeeting,
        connect: (credentials, preferences) =>
          call.meetingSession.connectWithToken(credentials, {
            ...preferences,
            useBrowserSession: true,
          }),
        disconnect: call.meetingSession.disconnect,
      }}
      renderCall={(onLeave, name) => (
        <CallOverlay
          onLeave={onLeave}
          localName={name()}
          showTeamSharing={canShareWithTeam()}
          sharedWithTeam={
            record.isSuccess ? record.data.shareWithTeam : undefined
          }
        />
      )}
    />
  );
}
