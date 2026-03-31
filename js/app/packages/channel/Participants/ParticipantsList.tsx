import type { ChannelParticipant } from '@queries/channel/types';
import { Show, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { VList } from 'virtua/solid';
import { ParticipantsEmptyState } from './ParticipantsEmptyState';
import { ParticipantsListItem } from './ParticipantsListItem';

export function ParticipantsList(props: {
  participants: Accessor<ChannelParticipant[]>;
  searchQuery: Accessor<string>;
  currentUserId?: string;
  editable: boolean;
  onRemoveParticipant: (participantId: string) => void;
}) {
  const [isDesktop, setIsDesktop] = createSignal(false);
  const desktopHeight = () => `${Math.min(props.participants().length * 56, 420)}px`;
  const listHeight = () => (isDesktop() ? desktopHeight() : '100%');

  onMount(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleChange = () => setIsDesktop(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    onCleanup(() => mediaQuery.removeEventListener('change', handleChange));
  });

  return (
    <Show
      when={props.participants().length > 0}
      fallback={<ParticipantsEmptyState searchQuery={props.searchQuery()} />}
    >
      <div class="min-h-0 h-full overflow-hidden">
        <VList
          data={props.participants()}
          class="h-full"
          style={{
            height: listHeight(),
            width: '100%',
          }}
          bufferSize={500}
        >
          {(participant) => (
            <ParticipantsListItem
              participant={participant}
              currentUserId={props.currentUserId}
              editable={props.editable}
              onRemove={() => props.onRemoveParticipant(participant.user_id)}
            />
          )}
        </VList>
      </div>
    </Show>
  );
}
