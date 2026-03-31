import type { ChannelParticipant } from '@queries/channel/types';
import { Show, type Accessor } from 'solid-js';
import { VList } from 'virtua/solid';
import { ParticipantsEmptyState } from './ParticipantsEmptyState';
import { ParticipantsListItem } from './ParticipantsListItem';

export function ParticipantsList(props: {
  participants: Accessor<ChannelParticipant[]>;
  searchQuery: Accessor<string>;
  currentUserId?: string;
  editable: boolean;
  onParticipantClick: (participantId: string) => void | Promise<void>;
  onRemoveParticipant: (participantId: string) => void;
}) {
  return (
    <Show
      when={props.participants().length > 0}
      fallback={<ParticipantsEmptyState searchQuery={props.searchQuery()} />}
    >
      <div class="min-h-0 h-full overflow-hidden md:h-[420px]">
        <VList
          data={props.participants()}
          class="h-full"
          style={{
            height: '100%',
            width: '100%',
          }}
          bufferSize={500}
        >
          {(participant) => (
            <ParticipantsListItem
              participant={participant}
              currentUserId={props.currentUserId}
              editable={props.editable}
              onClick={() => props.onParticipantClick(participant.user_id)}
              onRemove={() => props.onRemoveParticipant(participant.user_id)}
            />
          )}
        </VList>
      </div>
    </Show>
  );
}
