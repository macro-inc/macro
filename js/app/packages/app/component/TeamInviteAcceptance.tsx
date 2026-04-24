import { useNavigate, useSearchParams } from '@solidjs/router';
import { createMemo, Match, Switch } from 'solid-js';
import { useUserInfo } from '@queries/auth';
import {
  useJoinTeamMutation,
  useRejectInvitationMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import { useTeamQuery } from '@queries/team/teams';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { RoundPanel } from '@core/component/RoundPanel';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { Button } from '@ui/components/Button';
import UsersThreeIcon from '@icon/regular/users-three.svg';

export function TeamInviteAcceptance() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const userInfo = useUserInfo();

  const inviteId = () => searchParams.id as string | undefined;

  const invitesQuery = useUserInvitesQuery();

  const invite = createMemo(() => {
    const id = inviteId();
    if (!id || !invitesQuery.data?.invites) return undefined;
    return invitesQuery.data.invites.find((inv) => inv.id === id);
  });

  const teamId = createMemo(() => invite()?.team_id ?? '');
  const teamQuery = useTeamQuery(teamId);

  const teamName = createMemo(() => teamQuery.data?.team.name);

  const joinMutation = useJoinTeamMutation({
    onSuccess: () => {
      navigate('/', { replace: true });
    },
  });

  const rejectMutation = useRejectInvitationMutation({
    onSuccess: () => {
      navigate('/', { replace: true });
    },
  });

  const handleAccept = () => {
    const id = inviteId();
    if (!id) return;
    joinMutation.mutate({ teamInviteId: id });
  };

  const handleDecline = () => {
    const id = inviteId();
    if (!id) return;
    rejectMutation.mutate({ teamInviteId: id });
  };

  const handleLogin = () => {
    const id = inviteId();
    const returnUrl = id ? `/team-invite?id=${encodeURIComponent(id)}` : '/';
    navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  const isLoading = createMemo(
    () => invitesQuery.isLoading || teamQuery.isLoading
  );
  const isMutating = createMemo(
    () => joinMutation.isPending || rejectMutation.isPending
  );

  return (
    <div class="flex items-center justify-center h-full w-full p-8 overflow-hidden relative">
      <style>
        {`
          @keyframes invite-fade-up {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .invite-card {
            animation: invite-fade-up 300ms ease-out both;
          }
        `}
      </style>
      <div class="inset-0 absolute text-edge bg-panel opacity-10 -z-1">
        <PcNoiseGrid
          cellSize={30}
          warp={0}
          crunch={0.2}
          freq={0.001}
          size={[0, 0.3]}
          rounding={0}
          fill={0}
          stroke={1}
          speed={[0.017, 0.209]}
        />
      </div>

      <div class="w-full max-w-[420px] invite-card">
        <RoundPanel>
          <div class="flex flex-col gap-6 py-6 px-6">
            <div class="flex flex-col items-center">
              <Switch>
              <Match when={!inviteId()}>
                <NoInviteId onNavigate={() => navigate('/')} />
              </Match>

              <Match when={!userInfo()?.authenticated}>
                <UnauthenticatedView onLogin={handleLogin} />
              </Match>

              <Match when={isLoading()}>
                <LoadingBlock />
              </Match>

              <Match when={!invite()}>
                <InviteNotFound onNavigate={() => navigate('/')} />
              </Match>

              <Match when={invite()}>
                <InviteDetails
                  teamName={teamName()}
                  role={invite()!.team_role}
                  invitedBy={invite()!.invited_by}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                  isLoading={isMutating()}
                />
              </Match>
              </Switch>
            </div>
          </div>
        </RoundPanel>
      </div>
    </div>
  );
}

function NoInviteId(props: { onNavigate: () => void }) {
  return (
    <div class="flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-medium text-ink">Invalid Invite Link</h2>
      <p class="text-sm text-ink-muted">
        This invite link appears to be invalid or incomplete.
      </p>
      <Button variant="primary" size="md" onClick={props.onNavigate}>
        Go to Home
      </Button>
    </div>
  );
}

function UnauthenticatedView(props: { onLogin: () => void }) {
  return (
    <div class="flex flex-col items-center gap-4 text-center">
      <div class="p-3 rounded-full bg-accent/10">
        <UsersThreeIcon class="size-8 text-accent" />
      </div>
      <h2 class="text-lg font-medium text-ink">You've Been Invited</h2>
      <p class="text-sm text-ink-muted">
        Sign in or create an account to view and accept this team invitation.
      </p>
      <Button
        variant="primary"
        size="md"
        class="w-full"
        onClick={props.onLogin}
      >
        Sign In to Continue
      </Button>
    </div>
  );
}

function InviteNotFound(props: { onNavigate: () => void }) {
  return (
    <div class="flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-medium text-ink">Invite Not Found</h2>
      <p class="text-sm text-ink-muted">
        This invitation may have already been accepted, expired, or was sent to
        a different email address.
      </p>
      <Button variant="primary" size="md" onClick={props.onNavigate}>
        Go to Home
      </Button>
    </div>
  );
}

function InviteDetails(props: {
  teamName: string | undefined;
  role: string;
  invitedBy: string;
  onAccept: () => void;
  onDecline: () => void;
  isLoading: boolean;
}) {
  const displayTeamName = () => props.teamName ?? 'a team';
  const roleDisplay = () => {
    const role = props.role.toLowerCase();
    return role.charAt(0).toUpperCase() + role.slice(1);
  };

  return (
    <div class="flex flex-col items-center gap-6 text-center w-full">
      <div class="p-3 rounded-full bg-accent/10">
        <UsersThreeIcon class="size-8 text-accent" />
      </div>

      <div class="flex flex-col gap-2">
        <h2 class="text-lg font-medium text-ink">Join {displayTeamName()}</h2>
        <p class="text-sm text-ink-muted">
          <span class="text-ink">{props.invitedBy}</span> has invited you to
          join as a <span class="font-medium">{roleDisplay()}</span>.
        </p>
      </div>

      <div class="flex flex-col gap-3 w-full">
        <Button
          variant="accent"
          size="md"
          class="w-full"
          onClick={props.onAccept}
          disabled={props.isLoading}
        >
          {props.isLoading ? 'Joining...' : 'Accept Invitation'}
        </Button>
        <Button
          variant="ghost"
          size="md"
          class="w-full"
          onClick={props.onDecline}
          disabled={props.isLoading}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
