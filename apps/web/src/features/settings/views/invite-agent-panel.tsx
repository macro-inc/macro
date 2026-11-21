import { fireAndForget } from '@core/util/fireAndForget';
import { useComputerOffersQuery } from '@queries/computers/computers';
import type { JSX } from 'solid-js';
import {
  openAgentDirectMessage,
  openBilling,
} from '../../notifications/computer-setup-toast';
import { InviteAgentForm } from '../components/invite-agent-form';
import { useAddTeamAgent } from '../primitives/add-team-agent';

/**
 * The Agent side of Invite to Team, wired to the computer catalog. Add waits
 * here until the agent is online, then closes into its DM, where it has
 * said hi. Past the wait it closes into the DM anyway, where the setup card
 * shows the agent starting.
 */
export function InviteAgentPanel(props: {
  teamId: string;
  header?: JSX.Element;
  onCancel: () => void;
  /** The agent was added; the dialog closes. */
  onInvited: () => void;
}) {
  const offers = useComputerOffersQuery(() => true);
  const add = useAddTeamAgent({
    teamId: () => props.teamId,
    onAdded: ({ agent }) => {
      props.onInvited();
      fireAndForget(openAgentDirectMessage(agent.userId), 'team-agent.add');
    },
  });

  return (
    <InviteAgentForm
      header={props.header}
      offers={offers.isSuccess ? offers.data : undefined}
      offersFailed={offers.isError}
      onRetryOffers={() => fireAndForget(offers.refetch(), 'team-agent.offers')}
      state={add.state()}
      purchaseKey={add.purchaseKey()}
      onCancel={props.onCancel}
      onSubmit={(request, size) =>
        fireAndForget(add.add(request, size), 'team-agent.add')
      }
      onRetryStart={(agent) =>
        fireAndForget(add.retry(agent), 'team-agent.add')
      }
      onEdit={add.edit}
      onBilling={() => {
        props.onCancel();
        openBilling();
      }}
    />
  );
}
