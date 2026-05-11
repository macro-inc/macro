import { ShowFeatureFlag } from '@app/lib/analytics/posthog';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { ENABLE_TEAMS_OVERRIDE } from '@core/constant/featureFlags';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import SpinnerIcon from '@icon/regular/spinner.svg';
import UsersThreeIcon from '@icon/regular/users-three.svg';
import LogoIcon from '@macro-icons/macro-logo.svg';
import { useUserInfo } from '@queries/auth';
import {
  useJoinTeamMutation,
  useRejectInvitationMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import { useTeamQuery } from '@queries/team/teams';
import { Navigate, useNavigate, useSearchParams } from '@solidjs/router';
import { Button, Surface } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';

export function TeamInviteAcceptance() {
  return (
    <ShowFeatureFlag
      key="enable-teams-settings"
      enabledOverride={ENABLE_TEAMS_OVERRIDE}
      fallback={<Navigate href="/" />}
    >
      <TeamInviteAcceptanceContent />
    </ShowFeatureFlag>
  );
}

function TeamInviteAcceptanceContent() {
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

  return (
    <div class="flex items-center justify-center size-full p-8 overflow-hidden relative">
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

      <div class="w-full max-w-105 invite-card">
        <Surface>
          <div class="flex flex-col gap-6 p-6">
            <div class="flex justify-center">
              <LogoIcon class="size-10 text-accent" />
            </div>
            <div class="flex flex-col items-center">
              <Switch>
                <Match when={!inviteId()}>
                  <NoInviteId />
                </Match>

                <Match when={!userInfo()?.authenticated}>
                  <UnauthenticatedView onLogin={handleLogin} />
                </Match>

                <Match when={isLoading()}>
                  <LoadingBlock />
                </Match>

                <Match when={!invite()}>
                  <InviteNotFound />
                </Match>

                <Match when={invite()}>
                  <InviteDetails
                    teamName={teamName()}
                    role={invite()!.team_role}
                    invitedBy={invite()!.invited_by}
                    onAccept={handleAccept}
                    onDecline={handleDecline}
                    isJoining={joinMutation.isPending}
                    isDeclining={rejectMutation.isPending}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
}

function NoInviteId() {
  const navigate = useNavigate();
  return (
    <div class="w-full flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-medium text-ink">Invalid Invite Link</h2>
      <p class="text-sm text-ink-muted">
        This invite link appears to be invalid or incomplete.
      </p>
      <Button
        variant="base"
        size="md"
        class="w-full rounded-xs"
        onClick={() => navigate('/')}
      >
        Go to Home
      </Button>
    </div>
  );
}

function UnauthenticatedView(props: { onLogin: () => void }) {
  return (
    <div class="w-full flex flex-col items-center gap-4 text-center">
      <h2 class="flex items-center gap-2 text-lg font-medium text-ink">
        <EnvelopeIcon class="size-5" />
        You've Been Invited
      </h2>
      <p class="text-sm text-ink-muted">
        Sign in or create an account to view and accept this team invitation.
      </p>
      <Button
        variant="base"
        size="md"
        class="w-full rounded-xs"
        onClick={props.onLogin}
      >
        Sign In to Continue
      </Button>
    </div>
  );
}

function InviteNotFound() {
  const navigate = useNavigate();
  return (
    <div class="w-full flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-medium text-ink">Invite Not Found</h2>
      <p class="text-sm text-ink-muted">
        This invitation may have already been accepted, expired, or was sent to
        a different email address.
      </p>
      <Button
        variant="base"
        size="md"
        class="w-full rounded-xs"
        onClick={() => navigate('/')}
      >
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
  isJoining: boolean;
  isDeclining: boolean;
}) {
  const displayTeamName = () => props.teamName ?? 'a team';
  const roleDisplay = () => {
    const role = props.role.toLowerCase();
    return role.charAt(0).toUpperCase() + role.slice(1);
  };
  const isDisabled = () => props.isJoining || props.isDeclining;

  return (
    <div class="flex flex-col items-center gap-6 text-center w-full">
      <div class="flex flex-col gap-2">
        <h2 class="flex items-center justify-center gap-2 text-lg font-medium text-ink">
          <UsersThreeIcon class="size-5" />
          Join {displayTeamName()}
        </h2>
        <p class="text-sm text-ink-muted">
          <span class="text-ink">{props.invitedBy}</span> has invited you to
          join as a <span class="font-medium text-accent">{roleDisplay()}</span>
          .
        </p>
      </div>

      <div class="flex flex-col gap-2 w-full">
        <Button
          variant="base"
          size="md"
          class="w-full rounded-xs"
          onClick={props.onAccept}
          disabled={isDisabled()}
        >
          <Show when={props.isJoining} fallback="Accept Invitation">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
        <Button
          variant="ghost"
          size="md"
          class="w-full rounded-xs"
          onClick={props.onDecline}
          disabled={isDisabled()}
        >
          <Show when={props.isDeclining} fallback="Decline">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </div>
  );
}
