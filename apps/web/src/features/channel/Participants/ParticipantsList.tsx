import type { ChannelParticipant } from '@queries/channel/types';
import { type Accessor, For, Show } from 'solid-js';
import { ParticipantsEmptyState } from './ParticipantsEmptyState';
import { ParticipantsListItem } from './ParticipantsListItem';

export function ParticipantsList(props: {
  participants: Accessor<ChannelParticipant[]>;
  searchQuery: Accessor<string>;
  currentUserId?: string;
  editable: boolean;
  onParticipantClick: (
    participantId: string,
    event: MouseEvent
  ) => void | Promise<void>;
  onRemoveParticipant: (participantId: string) => void;
}) {
  return (
    <Show
      when={props.participants().length > 0}
      fallback={<ParticipantsEmptyState searchQuery={props.searchQuery()} />}
    >
      <div>
        <For each={props.participants()}>
          {(participant) => (
            <ParticipantsListItem
              participant={participant}
              currentUserId={props.currentUserId}
              editable={props.editable}
              onClick={(event) =>
                props.onParticipantClick(participant.user_id, event)
              }
              onRemove={() => props.onRemoveParticipant(participant.user_id)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
