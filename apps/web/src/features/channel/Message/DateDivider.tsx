import { formatRelativeDate, isSameDay } from '@core/util/time';
import { createMemo, Show } from 'solid-js';
import type { ChannelMessageListMeta } from './list-meta';
import { MessageFlag } from './MessageFlag';

type DateDividerProps = {
  createdAt: string;
  listMeta?: ChannelMessageListMeta;
  isReply?: boolean;
};

export function isDateDividerVisible(
  createdAt: string,
  listMeta?: ChannelMessageListMeta,
  isReply?: boolean
): boolean {
  if (isReply || !listMeta) return false;

  if (listMeta.index === 0) return true;

  const previousCreatedAt = listMeta.previousTopLevelCreatedAt;
  if (!previousCreatedAt) return false;

  return !isSameDay(new Date(createdAt), new Date(previousCreatedAt));
}

export function DateDivider(props: DateDividerProps) {
  const shouldRender = createMemo(
    () =>
      isDateDividerVisible(props.createdAt, props.listMeta, props.isReply) &&
      props.listMeta?.isFirstNewMessage !== true
  );

  return (
    <Show when={shouldRender()}>
      <MessageFlag text={formatRelativeDate(props.createdAt)} />
    </Show>
  );
}
