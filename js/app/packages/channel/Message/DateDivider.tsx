import { formatRelativeDate, isSameDay } from '@core/util/time';
import { Show, createMemo } from 'solid-js';
import type { ChannelMessageListMeta } from './list-meta';
import { MessageFlag } from './MessageFlag';

type DateDividerProps = {
  createdAt: string;
  listMeta?: ChannelMessageListMeta;
  isReply?: boolean;
};

export function DateDivider(props: DateDividerProps) {
  const shouldRender = createMemo(() => {
    if (props.isReply) return false;
    if (!props.listMeta) return false;

    if (props.listMeta.index === 0) return true;

    const previousCreatedAt = props.listMeta.previousTopLevelCreatedAt;
    if (!previousCreatedAt) return false;

    return !isSameDay(new Date(props.createdAt), new Date(previousCreatedAt));
  });

  return (
    <Show when={shouldRender()}>
      <MessageFlag
        text={formatRelativeDate(props.createdAt)}
        highlightAbove={props.listMeta?.isNewMessage}
        highlightBelow={props.listMeta?.isNewMessage}
      />
    </Show>
  );
}
