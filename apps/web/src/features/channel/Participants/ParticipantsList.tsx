import type { ChannelParticipant } from '@queries/channel/types';
import { Scroll } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';
import { Virtualizer } from 'virtua/solid';
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
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();

  return (
    <Scroll aria-label="Participants list" scrollRef={setScrollRoot}>
      <Show
        when={props.participants().length > 0}
        fallback={<ParticipantsEmptyState searchQuery={props.searchQuery()} />}
      >
        <div class="py-1">
          <Virtualizer
            data={props.participants()}
            scrollRef={scrollRoot()}
            startMargin={4}
          >
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
          </Virtualizer>
        </div>
      </Show>
    </Scroll>
  );
}
