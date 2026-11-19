import {
  ChannelCardLayout,
  toInboxCardDisplayItem,
} from '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts';
import { t } from '@app/lib/i18n';
import type { ChannelEntity } from '@entity';
import { SOUP_ROW_CLASS } from '@entity/composed/list-entity/row-geometry';
import { InboxDivider } from '@entity/composed/list-entity/shared';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { ChannelMentionCount } from './rail/ChannelCountPill';
import { JoinChannelButton } from './rail/next/JoinChannelButton';

/**
 * One conversation in the touch Channels feed, as Home's touch row
 * (InboxListEntity) lays it out: avatar column, unread rail, and a divider
 * inset to the content. The row is its own touch press surface
 * (rowPress.ts). A channel the viewer hasn't joined dims and offers Join.
 */
export function ChannelFeedRow(props: {
  channel: ChannelEntity;
  unread: boolean;
  /** Unread messages that mention the viewer. */
  mentions: number;
  /** A call is ringing the viewer here. */
  ringing: boolean;
  /** Call actions or the live-call badge. */
  trailing?: JSX.Element;
  divider: boolean;
  onOpen: (event: MouseEvent) => void;
}) {
  return (
    <div
      data-soup-entity
      data-press-surface
      class={cn(
        'soup-list-entity relative mx-(--soup-row-gutter)',
        SOUP_ROW_CLASS.card
      )}
    >
      <div
        class={cn(props.channel.isParticipant === false && 'opacity-50 pr-20')}
      >
        <ChannelCardLayout
          preview={props.ringing ? t('calls.callingYou') : undefined}
          trailing={props.trailing}
          badge={<ChannelMentionCount count={props.mentions} />}
          item={{
            ...toInboxCardDisplayItem(props.channel),
            unread: props.unread,
          }}
          onClick={(event) => props.onOpen(event)}
        />
      </div>
      <Show when={props.channel.isParticipant === false}>
        <div class="absolute top-5 right-(--mobile-chrome-gutter)">
          <JoinChannelButton channelId={props.channel.id} />
        </div>
      </Show>
      <Show when={props.divider}>
        <InboxDivider />
      </Show>
    </div>
  );
}
