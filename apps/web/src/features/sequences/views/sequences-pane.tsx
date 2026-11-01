import { type JSX, Show } from 'solid-js';
import { SequenceDetailView } from './sequence-detail';
import { SequenceListView } from './sequence-list';

/** Customers' Sequences section: the owner's list, or one sequence. */
export function SequencesPane(props: {
  sequenceId?: string;
  navigation?: JSX.Element;
  onOpen: (sequenceId: string) => void;
  onBack: () => void;
  onOpenContact: (contactId: string) => void;
}) {
  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <Show
        when={props.sequenceId}
        keyed
        fallback={
          <SequenceListView
            navigation={props.navigation}
            onOpen={props.onOpen}
          />
        }
      >
        {(sequenceId) => (
          <SequenceDetailView
            sequenceId={sequenceId}
            navigation={props.navigation}
            onBack={props.onBack}
            onOpenContact={props.onOpenContact}
          />
        )}
      </Show>
    </div>
  );
}
