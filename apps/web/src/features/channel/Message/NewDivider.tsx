import { formatRelativeDate } from '@core/util/time';
import { Show } from 'solid-js';
import { isDateDividerVisible } from './DateDivider';
import type { ChannelMessageListMeta } from './list-meta';
import { MessageFlag } from './MessageFlag';

type NewDividerProps = {
  createdAt: string;
  listMeta?: ChannelMessageListMeta;
  isReply?: boolean;
  onDismiss?: () => void;
};

export function NewDivider(props: NewDividerProps) {
  const isVisible = () =>
    !props.isReply && props.listMeta?.isFirstNewMessage === true;
  const text = () =>
    isDateDividerVisible(props.createdAt, props.listMeta, props.isReply)
      ? `${formatRelativeDate(props.createdAt)} - New`
      : 'New';

  return (
    <Show when={isVisible()}>
      <button
        type="button"
        class="w-full text-left"
        title="Mark as read"
        onClick={props.onDismiss}
      >
        <MessageFlag text={text()} highlight />
      </button>
    </Show>
  );
}
