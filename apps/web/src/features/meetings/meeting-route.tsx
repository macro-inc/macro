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
import { useParams, useSearchParams } from '@solidjs/router';
import { Show, Suspense } from 'solid-js';
import type { MeetingPageState } from './context/meeting-session';
import { MeetingPage } from './views/meeting-page';

function MeetingRouteContent(props: { shareToken: string }) {
  const [search] = useSearchParams();
  const call = useCallContext();
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
      authenticated={authenticated}
      author={author}
      avatar={
        <Show when={authenticated() && userId()} keyed>
          {(id) => (
            <UserIcon id={id} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      }
      autoJoin={search.join === 'true'}
      url={getMeetingUrl(props.shareToken)}
      onCopy={() =>
        navigator.clipboard.writeText(getMeetingUrl(props.shareToken))
      }
      onRename={canRename() ? rename : undefined}
      session={{
        shareToken: () => props.shareToken,
        isInCall: call.isInCall,
        activeCallId: call.activeCallId,
        join: (displayName) =>
          join.mutateAsync({ shareToken: props.shareToken, displayName }),
        release: leaveMeeting,
        connect: (credentials, preferences) =>
          call.connectSession(credentials, {
            ...preferences,
            useBrowserSession: true,
          }),
        disconnect: call.disconnectSession,
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

export function MeetingRoute() {
  const params = useParams<{ shareToken: string }>();
  return (
    <Suspense fallback={<div class="p-6 text-ink-muted">Loading call…</div>}>
      <Show when={params.shareToken} keyed>
        {(shareToken) => <MeetingRouteContent shareToken={shareToken} />}
      </Show>
    </Suspense>
  );
}
