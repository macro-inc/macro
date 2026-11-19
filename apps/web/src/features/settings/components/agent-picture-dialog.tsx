import { profilePictureItem } from '@core/signal/profilePicture';
import { getInitialsFromName } from '@core/user';
import { useSetAgentAvatarMutation } from '@queries/team-agents/avatar';
import type { TeamAgent } from '@service-auth/team-agents';
import { ResultAsync } from 'neverthrow';
import { Show } from 'solid-js';
import { ChangePictureDialog } from '../../agent-faces/views/change-picture-dialog';

/** An admin's Change picture dialog for one agent teammate; closed without one. */
export function AgentPictureDialog(props: {
  agent: TeamAgent | undefined;
  onClose: () => void;
}) {
  const save = useSetAgentAvatarMutation();
  return (
    <Show keyed when={props.agent}>
      {(agent) => (
        <ChangePictureDialog
          open
          onOpenChange={(open) => {
            if (!open) props.onClose();
          }}
          name={agent.name}
          initials={getInitialsFromName(agent.name, agent.name)}
          // Its saved face, else the one drawn for it from its id.
          face={
            profilePictureItem(agent.userId)?.face ?? {
              v: 1,
              seed: agent.userId,
              pins: {},
            }
          }
          onSave={async (picture) => {
            const saved = await ResultAsync.fromPromise(
              save.mutateAsync({ userId: agent.userId, avatar: picture }),
              (error) => error
            );
            return saved.isOk();
          }}
        />
      )}
    </Show>
  );
}
