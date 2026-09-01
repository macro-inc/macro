import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import { type ParentProps, Show } from 'solid-js';
import {
  ChannelCreatedIndicator,
  type ChannelMessageListMeta,
  DateDivider,
  NewDivider,
} from '../Message';

type ThreadRowProps = ParentProps & {
  ref?: (element: HTMLDivElement) => void;
  /** Present only in channel threads; other consumers (calls, PRs, comments) omit it. */
  channelId?: string;
  message: ApiChannelMessage;
  listMeta?: ChannelMessageListMeta;
  /** Discussions reuse the channel thread geometry without channel dividers. */
  showDividers?: boolean;
  onDismissNewMessages?: () => void;
};

export function ThreadRow(props: ThreadRowProps) {
  const channelCreatedId = () =>
    props.listMeta?.index === 0 && props.listMeta?.reachedStart
      ? props.channelId
      : undefined;

  return (
    <div
      ref={(element) => props.ref?.(element)}
      data-channel-thread-row
      class="w-full flex justify-center"
    >
      <div class="macro-message-width relative">
        <Show when={props.showDividers !== false}>
          <Show when={channelCreatedId()}>
            {(id) => <ChannelCreatedIndicator channelId={id()} />}
          </Show>
          <NewDivider
            createdAt={props.message.created_at}
            listMeta={props.listMeta}
            onDismiss={props.onDismissNewMessages}
          />
          <DateDivider
            createdAt={props.message.created_at}
            listMeta={props.listMeta}
          />
        </Show>
        <div class="relative isolate">
          {/* Pass-through rail: a later message in this sender run owns a
              thread; the spine runs through this row to reach it — from the
              avatar's center on the run's header, edge-to-edge on grouped
              rows. */}
          <Show when={props.listMeta?.threadRailBelow}>
            <div
              class="pointer-events-none absolute -z-1 channel-rail-left border-thread-rail left-(--left-of-channel-rail) bottom-0"
              style={{
                top: props.listMeta?.isGroupedWithPrevious
                  ? '0'
                  : 'calc(var(--regular-message-padding-t) + var(--user-icon-width) + var(--channel-rail-clearance))',
              }}
            />
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  );
}
