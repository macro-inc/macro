import { Show } from 'solid-js';
import type { ChannelMessageListMeta } from './list-meta';
import { MessageFlag } from './MessageFlag';

type NewDividerProps = {
  listMeta?: ChannelMessageListMeta;
  isReply?: boolean;
  onDismiss?: () => void;
};

export function NewDivider(props: NewDividerProps) {
  const isVisible = () =>
    !props.isReply && props.listMeta?.isFirstNewMessage === true;

  return (
    <Show when={isVisible()}>
      <button type="button" class="w-full text-left" onClick={props.onDismiss}>
        <MessageFlag text="New" highlightBelow />
      </button>
    </Show>
  );
}
