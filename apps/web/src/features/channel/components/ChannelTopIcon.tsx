import { useChannelType } from '@core/context/channels';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import type { ChannelParticipant } from '@queries/channel/types';
import { queryReadyGate } from '@queries/gate';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import { Show } from 'solid-js';
import { ChannelIcon } from '../channel-icon';

export type ChannelTopIconProps = {
  channelId: string;
  channelType: ChannelType | undefined;
  participants: ChannelParticipant[];
  suppressClick?: boolean;
};

/** Channel avatar, or the other participant's avatar for a direct message. */
export function ChannelTopIcon(props: ChannelTopIconProps) {
  return (
    <span class="inline-flex size-4">
      <ChannelIcon
        channelId={props.channelId}
        channelType={props.channelType}
        participantIds={props.participants.map(
          (participant) => participant.user_id
        )}
        avatarSize="sm"
        class="[&_img]:rounded-full"
        suppressClick={props.suppressClick}
        showTooltip={props.suppressClick ? false : undefined}
      />
    </span>
  );
}

/** Resolve conversation identity for headers and navigation breadcrumbs. */
export function ChannelTitleIcon(props: {
  channelId: string;
  suppressClick?: boolean;
}) {
  return (
    <Show when={props.channelId} keyed>
      {(channelId) => {
        const channelType = useChannelType(channelId);
        const participants = useChannelParticipantsQuery(() => channelId);
        return (
          <ChannelTopIcon
            channelId={channelId}
            channelType={channelType()}
            participants={queryReadyGate(participants) ? participants.data : []}
            suppressClick={props.suppressClick}
          />
        );
      }}
    </Show>
  );
}
