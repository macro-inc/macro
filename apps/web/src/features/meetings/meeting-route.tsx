import { useCallContext } from '@channel/Call/CallContext';
import { CallOverlay } from '@channel/Call/CallOverlay';
import { getMeetingUrl } from '@channel/Call/call-link';
import { CallDiscussionContent } from '@channel/Call/discussion/CallDiscussionContent';
import { callDiscussionOf } from '@channel/Call/discussion/call-discussion';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useIsAuthenticated, useUserId } from '@core/context/user';
import { readBackgroundImage } from '@core/media/read-background-image';
import { isMobile } from '@core/mobile/isMobile';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCallRecordQuery } from '@queries/call/call';
import {
  leaveMeeting,
  useJoinMeetingMutation,
  useMeetingParticipantsQuery,
  useMeetingQuery,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import { useLocation, useNavigate, useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { browserMeetingMedia } from './browser/meeting-media';
import { preloadMeetingRuntime } from './browser/meeting-runtime';
import type { MeetingParticipantsState } from './components/meeting-participants';
import type { MeetingPageState } from './context/meeting-session';
import { useMeetingSessionLifecycle } from './context/meeting-session-lifecycle';
import { MeetingPage } from './views/meeting-page';

export function MeetingRouteContent(props: {
  shareToken: string;
  onCallStateChange: (connected: boolean) => void;
  onLeave: (path: string) => void;
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
  const participants = useMeetingParticipantsQuery(
    () => props.shareToken,
    userId,
    () =>
      meeting.isSuccess &&
      (authenticated() === false ||
        (authenticated() === true && Boolean(userId()))) &&
      (meeting.data.channelId === null || authenticated() === true) &&
      !call.isInCall()
  );
  const participantState = (): MeetingParticipantsState => {
    if (participants.isError) return { kind: 'unavailable' };
    if (!participants.isSuccess) return { kind: 'loading' };
    return { kind: 'ready', participants: participants.data.participants };
  };
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

  const discussion = () => callDiscussionOf(record, call.activeCallId());
  const [outsideCount, setOutsideCount] = createSignal(0);

  const source = (): MeetingPageState => {
    if (meeting.isError) return { kind: 'unavailable' };
    if (!meeting.isSuccess) return { kind: 'loading' };
    return { kind: 'ready', ...meeting.data };
  };

  return (
    <MeetingPage
      source={source}
      participants={participantState()}
      onCallStateChange={props.onCallStateChange}
      onLeave={props.onLeave}
      onBack={() => navigate('/app')}
      mediaAccess={browserMeetingMedia}
      initialBackground={call.backgroundEffect()}
      readBackgroundImage={readBackgroundImage}
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
        warmup: preloadMeetingRuntime,
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
      renderCall={(onLeave, name, credentials, copyButton) => (
        <CallOverlay
          onLeave={onLeave}
          localName={name()}
          footerLeading={copyButton}
          showChat={
            authenticated() === true ||
            (authenticated() === false && !!credentials())
          }
          guestChatSession={
            authenticated() === false ? credentials() : undefined
          }
          showTeamSharing={canShareWithTeam()}
          sharedWithTeam={
            record.isSuccess ? record.data.shareWithTeam : undefined
          }
          discussion={
            authenticated() === true
              ? {
                  label: () =>
                    discussion()?.kind === 'channel_thread' && record.isSuccess
                      ? (record.data.channelName ?? undefined)
                      : undefined,
                  opensByDefault: () =>
                    !isMobile() && discussion()?.kind === 'channel_thread',
                  hasUpdates: () => outsideCount() > 0,
                  render: (panel) => (
                    <CallDiscussionContent
                      discussion={discussion}
                      panel={panel}
                      onViewChannel={(channelId) =>
                        navigate(
                          buildSimpleEntityUrl({
                            type: 'channel',
                            id: channelId,
                          })
                        )
                      }
                      onOutsideCountChange={setOutsideCount}
                    />
                  ),
                }
              : undefined
          }
        />
      )}
    />
  );
}
