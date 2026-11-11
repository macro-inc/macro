import { RecipientSelector } from '@core/component/RecipientSelector';
import type { WithCustomUserInput } from '@core/user/combinedRecipient';
import type { RecipientSourceFactory } from '@core/user/recipient-source';
import { getDestinationFromOptions } from '@core/util/destination';
import type { ChannelParticipant } from '@queries/channel/types';
import { Button, inputClasses } from '@ui';
import { type Accessor, createMemo, createSignal } from 'solid-js';

export function ParticipantsAddPanel(props: {
  participants: Accessor<ChannelParticipant[]>;
  createSource: RecipientSourceFactory<'user'>;
  onAddParticipants: (participantIds: string[]) => void;
}) {
  const [selectedUsers, setSelectedUsers] = createSignal<
    WithCustomUserInput<'user'>[]
  >([]);

  const existing = createMemo(
    () =>
      new Set(props.participants().map((participant) => participant.user_id))
  );
  const participantIds = createMemo(() =>
    getDestinationFromOptions(selectedUsers()).users.filter(
      (id) => !existing().has(id)
    )
  );

  const handleAddParticipants = () => {
    const ids = participantIds();
    if (!ids.length) return;
    props.onAddParticipants(ids);
    setSelectedUsers([]);
  };

  return (
    <div class="flex flex-col gap-2 md:flex-row md:items-center">
      <div class="min-w-0 flex-1">
        <RecipientSelector<'user'>
          setSelectedOptions={setSelectedUsers}
          selectedOptions={selectedUsers()}
          placeholder="Add participants by name or email"
          createSource={props.createSource}
          excludedIds={existing}
          portalScope="local"
          noPadding
          class={inputClasses({
            class:
              'h-auto min-h-9 rounded-full py-0.5 focus-within:ring-2 focus-within:ring-edge-muted',
          })}
        />
      </div>
      <Button
        variant="secondary"
        disabled={participantIds().length === 0}
        onClick={handleAddParticipants}
      >
        {selectedUsers().length > 1 ? 'Add Participants' : 'Add Participant'}
      </Button>
    </div>
  );
}
