import {
  profilePictureItem,
  useProfilePictureUrl,
} from '@core/signal/profilePicture';
import { getInitialsFromName } from '@core/user';
import { derivedAgentFace } from '@core/user/agent-face';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import { useSetAgentAvatarMutation } from '@queries/team-agents/avatar';
import type { TeamAgent } from '@service-auth/team-agents';
import { ResultAsync } from 'neverthrow';
import { Show } from 'solid-js';
import { ChangePictureDialog } from '../../agent-faces/views/change-picture-dialog';

export type AgentPictureSelection = {
  agent: TeamAgent;
  opener: HTMLButtonElement | undefined;
};

/** An admin's Change picture dialog for one agent teammate; closed without one. */
export function AgentPictureDialog(props: {
  selection: AgentPictureSelection | undefined;
  onClose: () => void;
}) {
  const save = useSetAgentAvatarMutation();
  return (
    <Show keyed when={props.selection}>
      {({ agent, opener }) => {
        const account = currentQueryAccount();
        const [, picture] = useProfilePictureUrl(agent.userId);
        const pictureState = () => {
          const item = profilePictureItem(agent.userId);
          if (!item || item.loading) return 'loading';
          if (item._createdAt.getTime() === 0) return 'error';
          return 'ready';
        };
        const isCurrent = () => isCurrentQueryAccount(account);
        return (
          <ChangePictureDialog
            onCloseAutoFocus={(event) => {
              if (!opener?.isConnected) return;
              event.preventDefault();
              opener.focus({ preventScroll: true });
            }}
            isCurrent={isCurrent}
            pictureState={pictureState()}
            onRetryPicture={picture.refetch}
            open
            onOpenChange={(open) => {
              if (!open) props.onClose();
            }}
            name={agent.name}
            initials={getInitialsFromName(agent.name, agent.name)}
            // Its saved face, else the one drawn for it from its id.
            face={
              profilePictureItem(agent.userId)?.face ??
              derivedAgentFace(agent.userId)
            }
            photoUrl={
              profilePictureItem(agent.userId)?.face
                ? undefined
                : profilePictureItem(agent.userId)?.url
            }
            onSave={async (picture) => {
              if (!isCurrent()) return false;
              const saved = await ResultAsync.fromPromise(
                save.mutateAsync({ userId: agent.userId, avatar: picture }),
                (error) => error
              );
              return saved.isOk();
            }}
          />
        );
      }}
    </Show>
  );
}
