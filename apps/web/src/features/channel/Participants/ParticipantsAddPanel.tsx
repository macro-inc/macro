import { RecipientSelector } from '@core/component/RecipientSelector';
import {
  recipientEntityMapper,
  useContacts,
  type WithCustomUserInput,
} from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import type { ChannelParticipant } from '@queries/channel/types';
import { Button } from '@ui';
import { type Accessor, createSignal } from 'solid-js';

export function ParticipantsAddPanel(props: {
  participants: Accessor<ChannelParticipant[]>;
  onAddParticipants: (participantIds: string[]) => void;
}) {
  const contacts = useContacts();
  const [selectedUsers, setSelectedUsers] = createSignal<
    WithCustomUserInput<'user'>[]
  >([]);

  const options = () => {
    const existingParticipantIds = new Set(
      props.participants().map((participant) => participant.user_id)
    );

    return (
      contacts()
        ?.filter((user) => !existingParticipantIds.has(user.id))
        .map(recipientEntityMapper('user')) ?? []
    );
  };

  const handleAddParticipants = () => {
    const destination = getDestinationFromOptions(selectedUsers());
    props.onAddParticipants(destination.users);
    setSelectedUsers([]);
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1 basis-60">
        <RecipientSelector<'user'>
          setSelectedOptions={setSelectedUsers}
          selectedOptions={selectedUsers()}
          placeholder="name@company.com"
          options={options}
        />
      </div>
      <Button
        variant="outline"
        disabled={selectedUsers().length === 0}
        onClick={handleAddParticipants}
      >
        {selectedUsers().length > 1 ? 'Add Participants' : 'Add Participant'}
      </Button>
    </div>
  );
}
