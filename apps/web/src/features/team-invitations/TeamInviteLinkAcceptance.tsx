import { LoadingBlock } from '@core/component/LoadingBlock';
import { toast } from '@core/component/Toast/Toast';
import { thrownResultErrorHasCode } from '@core/util/result';
import SpinnerIcon from '@phosphor/spinner.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import {
  useJoinTeamByInviteLinkMutation,
  useTeamByInviteLinkQuery,
} from '@queries/team/invite-link';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';

/**
 * The page a team's shareable invite link opens, for a signed-in user: names
 * the team and joins it on confirmation.
 */
export function TeamInviteLinkAcceptance(props: { token: string }) {
  const navigate = useNavigate();
  const teamQuery = useTeamByInviteLinkQuery(
    () => props.token,
    () => true
  );
  // Keep the team on screen through a failed refetch; only a link the server
  // says is gone is "not valid".
  const team = () => (teamQuery.isPending ? undefined : teamQuery.data);
  const teamName = () => team()?.team_name ?? '';

  const joinMutation = useJoinTeamByInviteLinkMutation({
    onSuccess: (result) => {
      toast.success(
        result.already_member
          ? `You're already on ${teamName()}`
          : `Joined ${teamName()}`
      );
      navigate('/', { replace: true });
    },
  });
  const linkGone = () =>
    thrownResultErrorHasCode(teamQuery.error, 'NOT_FOUND') ||
    thrownResultErrorHasCode(joinMutation.error, 'NOT_FOUND');
  const joinConflict = () =>
    joinMutation.isError &&
    thrownResultErrorHasCode(joinMutation.error, 'CONFLICT');

  return (
    <Switch>
      <Match when={teamQuery.isPending}>
        <LoadingBlock />
      </Match>
      <Match when={linkGone()}>
        <Outcome
          title="Invite Link Not Valid"
          body="This invite link was reset or turned off. Ask someone on the team for a new one."
        />
      </Match>
      <Match when={joinConflict()}>
        <Outcome
          title="Already on Another Team"
          body="You can be on one team at a time. Leave your current team in Settings to join this one."
        />
      </Match>
      <Match when={!team()}>
        <Outcome
          title="Couldn't Load Invite"
          body="Check your connection and open the link again."
        />
      </Match>
      <Match when={team()}>
        <div class="flex flex-col items-center gap-6 text-center w-full">
          <div class="flex flex-col gap-2">
            <h2 class="flex items-center justify-center gap-2 text-lg font-medium text-ink">
              <UsersThreeIcon class="size-5" />
              Join {teamName()}
            </h2>
            <p class="text-sm text-ink-muted">
              You've been invited to join{' '}
              <span class="text-ink">{teamName()}</span> on Macro.
            </p>
          </div>
          <Button
            variant="outline"
            size="md"
            class="w-full"
            disabled={joinMutation.isPending}
            onClick={() => joinMutation.mutate({ token: props.token })}
          >
            <Show when={joinMutation.isPending} fallback="Join Team">
              <SpinnerIcon class="size-4 animate-spin" />
            </Show>
          </Button>
          <Show when={joinMutation.isError}>
            <p class="text-sm text-failure-ink" role="alert">
              Couldn't join the team. Try again.
            </p>
          </Show>
        </div>
      </Match>
    </Switch>
  );
}

function Outcome(props: { title: string; body: string }) {
  const navigate = useNavigate();
  return (
    <div class="w-full flex flex-col items-center gap-4 text-center">
      <h2 class="text-lg font-medium text-ink">{props.title}</h2>
      <p class="text-sm text-ink-muted">{props.body}</p>
      <Button
        variant="outline"
        size="md"
        class="w-full"
        onClick={() => navigate('/')}
      >
        Go to Home
      </Button>
    </div>
  );
}
