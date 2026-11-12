import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { useUploadAgentAvatarMutation } from '@queries/agents/avatar';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useCreateTeamAgentMutation } from '@queries/team-agents/team-agents';
import type { CreateTeamAgent } from '@service-auth/team-agents';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { InviteAgentForm } from '../components/invite-agent-form';

/** What to tell the admin when the server refuses an invite. */
function inviteFailure(error: unknown): string {
  if (!(error instanceof ThrownResultError)) return t('teamAgents.failed');

  const reason = error.errors[0];
  return (
    match(reason?.code)
      .with('INVALID_AGENT', () => t('teamAgents.invalid'))
      .with('AGENTS_NOT_ENABLED', () => t('teamAgents.notEnabled'))
      // The server's reason (sold out, no subscription) is safe to show.
      .with(
        'COMPUTER_UNAVAILABLE',
        () => `${t('teamAgents.computerUnavailable')} ${reason?.message ?? ''}`
      )
      .with('REPOSITORY_FAILED', () => t('teamAgents.repositoryFailed'))
      .otherwise(() => t('teamAgents.failed'))
  );
}

/** The Agent side of Invite to Team, wired to the computer catalog. */
export function InviteAgentPanel(props: {
  teamId: string;
  header?: JSX.Element;
  onCancel: () => void;
  onInvited: () => void;
}) {
  const offers = useComputerOffersQuery(() => true);
  const upload = useUploadAgentAvatarMutation();
  const create = useCreateTeamAgentMutation();
  const [error, setError] = createSignal<string>();
  // Closing the dialog mid-invite still toasts the result, but must not
  // close it again or write into a form that is gone.
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const invite = async (request: CreateTeamAgent) => {
    setError(undefined);
    try {
      const agent = await create.mutateAsync({
        teamId: props.teamId,
        request,
      });
      toast.success(t('teamAgents.invited', { name: agent.name }), {
        subtext: t('teamAgents.invitedDescription'),
      });
      if (!disposed) props.onInvited();
    } catch (failure) {
      if (!disposed) setError(inviteFailure(failure));
    }
  };

  return (
    <InviteAgentForm
      header={props.header}
      offers={offers.isSuccess ? offers.data : undefined}
      offersFailed={offers.isError}
      onRetryOffers={() => fireAndForget(offers.refetch(), 'team-agent.offers')}
      uploadPicture={(file) => upload.mutateAsync(file)}
      pending={create.isPending}
      error={error()}
      onCancel={props.onCancel}
      onSubmit={(request) =>
        fireAndForget(invite(request), 'team-agent.invite')
      }
    />
  );
}
