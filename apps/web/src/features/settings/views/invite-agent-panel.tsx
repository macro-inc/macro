import { fireAndForget } from '@core/util/fireAndForget';
import { useComputerOffersQuery } from '@queries/computers/computers';
import {
  openAgentDirectMessage,
  openBilling,
} from '../../notifications/computer-setup-toast';
import { InviteAgentForm } from '../components/invite-agent-form';
import { useAddTeamAgent } from '../primitives/add-team-agent';
import { createAgentInviteDraft } from '../primitives/agent-invite-draft';

/**
 * The Agent side of Invite to Team, wired to the computer catalog. Add waits
 * here until the agent is online, then closes into its DM, where it has
 * said hi. Past the wait it closes into the DM anyway, where the setup card
 * shows the agent starting.
 */
export function InviteAgentPanel(props: {
  teamId: string;
  onCancel: () => void;
  /** The agent was added; the dialog closes. */
  onInvited: () => void;
}) {
  const offers = useComputerOffersQuery(() => true);
  // What was typed before Update card took the admin to Billing.
  const draft = createAgentInviteDraft(props.teamId);
  const add = useAddTeamAgent({
    teamId: () => props.teamId,
    onAdded: ({ agent }) => {
      draft.forget();
      props.onInvited();
      fireAndForget(openAgentDirectMessage(agent.userId), 'team-agent.add');
    },
  });

  return (
    <InviteAgentForm
      offers={offers.isSuccess ? offers.data : undefined}
      offersFailed={offers.isError}
      onRetryOffers={() => fireAndForget(offers.refetch(), 'team-agent.offers')}
      state={add.state()}
      purchaseKey={add.purchaseKey()}
      initialName={draft.initial?.name}
      initialSize={draft.initial?.size}
      onCancel={() => {
        draft.forget();
        props.onCancel();
      }}
      onSubmit={(request, size) =>
        fireAndForget(add.add(request, size), 'team-agent.add')
      }
      onRetryStart={(agent) =>
        fireAndForget(add.retry(agent), 'team-agent.add')
      }
      onEdit={add.edit}
      onBilling={({ name, size }) => {
        draft.save(name, size);
        props.onCancel();
        openBilling();
      }}
    />
  );
}
