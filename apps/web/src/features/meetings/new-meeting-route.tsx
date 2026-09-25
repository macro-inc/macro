import { useCallContext } from '@channel/Call/CallContext';
import { CallOverlay } from '@channel/Call/CallOverlay';
import { getMeetingUrl } from '@channel/Call/call-link';
import { UserIcon } from '@core/component/UserIcon';
import { useAuthor, useIsAuthenticated, useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { useCallRecordQuery } from '@queries/call/call';
import {
  leaveMeeting,
  useCreateMeetingMutation,
  useInviteMeetingUsersMutation,
  useJoinMeetingMutation,
  useMeetingQuery,
  useUpdateMeetingMutation,
} from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { Show, Suspense } from 'solid-js';
import type { MeetingPageState } from './context/meeting-session';
import { useMeetingSessionLifecycle } from './context/meeting-session-lifecycle';
import { createNewMeeting } from './primitives/new-meeting';
import { useMeetingTeammatesSource } from './queries/meeting-teammates';
import { MeetingInvite } from './views/meeting-invite';
import { MeetingPage } from './views/meeting-page';

function NewMeetingSetup(props: {
  userId: string;
  onCallStateChange: (connected: boolean, shareToken: string) => void;
  onLeave: () => void;
}) {
  const call = useCallContext();
  const lifecycle = useMeetingSessionLifecycle();
  const author = useAuthor();
  const people = useMeetingTeammatesSource(() => props.userId, idToDisplayName);
  const create = useCreateMeetingMutation();
  const invite = useInviteMeetingUsersMutation();
  const join = useJoinMeetingMutation();
  const update = useUpdateMeetingMutation();
  const draft = createNewMeeting({
    people: people.people,
    create: () => create.mutateAsync({ title: 'Quick Call' }),
    invite: (shareToken, userIds) =>
      invite.mutateAsync({ shareToken, userIds }),
  });
  const shareToken = () => draft.meeting()?.shareToken ?? '';
  const meeting = useMeetingQuery(shareToken);
  const record = useCallRecordQuery(() => call.activeCallId() ?? '');
  const canRename = () =>
    record.isSuccess &&
    record.data.callId === call.activeCallId() &&
    record.data.createdBy === props.userId;
  const url = () => (shareToken() ? getMeetingUrl(shareToken()) : undefined);
  const source = (): MeetingPageState => ({
    kind: 'ready',
    title: meeting.isSuccess ? meeting.data.title : 'Quick Call',
    scheduledStart: null,
    scheduledEnd: null,
    channelId: null,
  });

  async function rename(title: string) {
    const created = draft.meeting();
    if (!created || !canRename())
      throw new Error('Only the call owner can rename this call.');
    await update.mutateAsync({ meetingId: created.id, title });
  }

  return (
    <MeetingPage
      source={source}
      onLeave={props.onLeave}
      onCallStateChange={(connected) =>
        props.onCallStateChange(connected, shareToken())
      }
      authenticated={() => true}
      author={author}
      avatar={
        <UserIcon
          id={props.userId}
          size="fill"
          suppressClick
          showTooltip={false}
        />
      }
      mediaAccess={{
        request: (constraints) =>
          navigator.mediaDevices.getUserMedia(constraints),
      }}
      startCall
      url={url()}
      onCopy={async () => {
        const link = url();
        if (link) await navigator.clipboard.writeText(link);
      }}
      onRename={canRename() ? rename : undefined}
      renderInvite={(joining) => (
        <div class="flex flex-col gap-2">
          <MeetingInvite
            source={people}
            selected={draft.selected}
            setSelected={draft.select}
            disabled={joining()}
          />
          <Show when={draft.selectionError()}>
            <p role="alert" class="text-sm text-failure">
              {draft.selectionError()}
            </p>
          </Show>
        </div>
      )}
      session={{
        lifecycle,
        shareToken,
        prepare: draft.prepare,
        isInCall: call.isInCall,
        activeCallId: call.activeCallId,
        join: () => join.mutateAsync({ shareToken: shareToken() }),
        release: leaveMeeting,
        connect: async (credentials, preferences) => {
          await call.meetingSession.connectWithToken(credentials, {
            ...preferences,
            useBrowserSession: true,
          });
          if (call.isInCall() && call.activeCallId() === credentials.callId) {
            await draft.ring();
          }
        },
        disconnect: call.meetingSession.disconnect,
      }}
      renderCall={(onLeave, name) => (
        <div class="flex h-full min-h-0 flex-col">
          <Show when={draft.inviteError()}>
            <div
              role="alert"
              class="mb-3 flex items-center justify-between gap-3 rounded-lg bg-hover p-3 text-sm"
            >
              <span>{draft.inviteError()}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={draft.inviting()}
                onClick={() => void draft.ring()}
              >
                {draft.inviting() ? 'Sending…' : 'Retry invites'}
              </Button>
            </div>
          </Show>
          <div class="min-h-0 flex-1">
            <CallOverlay
              onLeave={onLeave}
              localName={name()}
              showTeamSharing={false}
            />
          </div>
        </div>
      )}
    />
  );
}

export function NewMeetingRoute(props: {
  onCallStateChange: (connected: boolean, shareToken: string) => void;
  onLeave: () => void;
}) {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  const navigate = useNavigate();
  return (
    <Suspense fallback={<div class="p-6 text-ink-muted">Loading call…</div>}>
      <Show
        when={authenticated() === true && userId()}
        keyed
        fallback={
          <div class="flex h-dvh flex-col items-center justify-center gap-4 bg-surface text-ink">
            <Show
              when={authenticated() === false}
              fallback={<p>Loading call…</p>}
            >
              <h1 class="text-2xl font-semibold">Sign in to start a call</h1>
              <Button
                variant="ghost"
                class="bg-hover"
                onClick={() => navigate('/login?redirect=%2Fmeet%2Fnew')}
              >
                Sign in
              </Button>
            </Show>
          </div>
        }
      >
        {(id) => (
          <NewMeetingSetup
            userId={id}
            onCallStateChange={props.onCallStateChange}
            onLeave={props.onLeave}
          />
        )}
      </Show>
    </Suspense>
  );
}
