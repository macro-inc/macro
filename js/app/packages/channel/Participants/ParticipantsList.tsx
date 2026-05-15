import { CustomScrollbar } from '@core/component/CustomScrollbar';
import type { ChannelParticipant } from '@queries/channel/types';
import { type Accessor, createSignal, Show } from 'solid-js';
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
  const [listWrapperRef, setListWrapperRef] = createSignal<HTMLDivElement>();

  const scrollContainer = () => {
    const el = listWrapperRef();
    if (!el) return undefined;
    return (
      (el.querySelector(
        '[data-participants-list-container]'
      ) as HTMLElement | null) ?? undefined
    );
  };

  return (
    <Show
      when={props.participants().length > 0}
      fallback={<ParticipantsEmptyState searchQuery={props.searchQuery()} />}
    >
      <div ref={setListWrapperRef} class="relative h-full min-h-0">
        <VList
          data={props.participants()}
          class="h-full scrollbar-hidden"
          style={{
            height: '100%',
            width: '100%',
          }}
          bufferSize={500}
          data-participants-list-container
        >
          {(participant, index) => (
            <ParticipantsListItem
              participant={participant}
              currentUserId={props.currentUserId}
              editable={props.editable}
              isLast={index() === props.participants().length - 1}
              onClick={() => props.onParticipantClick(participant.user_id)}
              onRemove={() => props.onRemoveParticipant(participant.user_id)}
            />
          )}
        </VList>
        <CustomScrollbar scrollContainer={scrollContainer} />
      </div>
    </Show>
  );
}
