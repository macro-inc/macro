import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_AGENT_FACES } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import { useComputerOffersQuery } from '@queries/computers/computers';
import type { CreateTeamAgent } from '@service-auth/team-agents';
import { FaceSlot } from '../../agent-faces/face-slot';
import { createFaceDraft } from '../../agent-faces/primitives/create-face-draft';
import { createPictureUploads } from '../../agent-faces/primitives/upload-agent-picture';
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
  onCancel: () => void;
  /** The agent was added; the dialog closes. */
  onInvited: () => void;
}) {
  const offers = useComputerOffersQuery(() => true);
  // A new random face each time the panel opens.
  const face = createFaceDraft();
  // One upload per face, however often Add is pressed.
  const uploadPicture = createPictureUploads();
  // A picture that can't be saved doesn't stop the agent being added: it
  // keeps its face (drawn from the recipe) or, for a photo, its initial.
  const preparePicture = async (): Promise<
    Partial<CreateTeamAgent> | undefined
  > => {
    const account = currentQueryAccount();
    const teamId = props.teamId;
    const picture = await uploadPicture(face);
    if (!isCurrentQueryAccount(account) || props.teamId !== teamId) return;
    if (picture.isErr()) {
      toast.failure(t('agentFaces.photoFailed'));
      return {};
    }
    return { avatarFace: picture.value.face, avatarUrl: picture.value.url };
  };
  const add = useAddTeamAgent({
    teamId: () => props.teamId,
    onAdded: ({ agent }) => {
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
      onCancel={props.onCancel}
      onSubmit={(request, size) =>
        fireAndForget(add.add(request, size), 'team-agent.add')
      }
      onRetryStart={(agent) =>
        fireAndForget(add.retry(agent), 'team-agent.add')
      }
      onEdit={add.edit}
      avatar={
        ENABLE_AGENT_FACES
          ? (initial) => (
              <FaceSlot draft={face} initials={initial()} size={64} />
            )
          : undefined
      }
      prepareAvatar={ENABLE_AGENT_FACES ? preparePicture : undefined}
      onBilling={() => {
        props.onCancel();
        openBilling();
      }}
    />
  );
}
