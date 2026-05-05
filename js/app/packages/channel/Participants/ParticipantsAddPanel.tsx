import { getDestinationFromOptions } from '@core/util/destination';
import { RecipientSelector } from '@core/component/RecipientSelector';
import {
  recipientEntityMapper,
  useContacts,
  type WithCustomUserInput,
} from '@core/user';
import type { ChannelParticipant } from '@queries/channel/types';
import { createSignal, type Accessor } from 'solid-js';

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
    <div class="flex flex-col gap-2 md:flex-row md:items-center">
      <div class="min-w-0 flex-1 rounded-xs border border-edge-muted bg-input px-3 py-2 text-sm text-ink outline-none focus-within:border-accent/50">
        <RecipientSelector<'user'>
          setSelectedOptions={setSelectedUsers}
          selectedOptions={selectedUsers()}
          placeholder="name@company.com"
          options={options}
          hideBorder
          noPadding
        />
      </div>
      <button
        type="button"
        disabled={selectedUsers().length === 0}
        onClick={handleAddParticipants}
        class="w-full shrink-0 rounded-xs bg-accent px-3 py-1.5 text-sm font-medium text-menu transition-colors hover:bg-accent/90 disabled:opacity-50 md:w-auto"
      >
        {selectedUsers().length > 1 ? 'Add Participants' : 'Add Participant'}
      </button>
    </div>
  );
}
