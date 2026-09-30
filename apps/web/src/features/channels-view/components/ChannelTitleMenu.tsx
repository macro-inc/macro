import { toSingleEntityActionListState } from '@app/features/next-soup/actions';
import { SoupEntityActionsDropdown } from '@app/features/soup/SoupEntityActionsDropdown';
import { ChannelDetailTitle } from '@channel/Channel/ChannelDetail';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { CHANNEL_ACTION_VIEW_CONTEXT } from './rail/ChannelRailItems';

/**
 * The conversation header's title, doubling as its action menu. It offers the
 * same entity actions as the channel's row in the rail, so favoriting, muting
 * or renaming a conversation works from the conversation itself.
 */
export function ChannelTitleMenu(props: { channel: ChannelEntity }) {
  const list = toSingleEntityActionListState(() => props.channel);

  return (
    <SoupEntityActionsDropdown
      entity={props.channel}
      list={list}
      viewContext={CHANNEL_ACTION_VIEW_CONTEXT}
      // No aria-label: the conversation's name is the button's own content,
      // and Kobalte's trigger already announces that it opens a menu.
      triggerProps={{ class: 'min-w-0 shrink gap-1.5 px-2' }}
    >
      <ChannelDetailTitle
        channelId={props.channel.id}
        fallbackName={props.channel.name}
      />
      <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
    </SoupEntityActionsDropdown>
  );
}
