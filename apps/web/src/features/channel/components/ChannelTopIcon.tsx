import { ChannelAvatar } from '@channel/channel-avatar';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import type { ChannelParticipant } from '@queries/channel/types';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { Show } from 'solid-js';

export type ChannelTopIconProps = {
  channelId: string;
  channelType: ChannelType | undefined;
  participants: ChannelParticipant[];
};

/** Channel avatar, or the other participant's avatar for a direct message. */
export function ChannelTopIcon(props: ChannelTopIconProps) {
  const userId = useUserId();
  const recipient = () => {
    return props.participants.find((p) => p && p.user_id !== userId());
  };

  return (
    <Show
      when={props.channelType === ChannelType.direct_message && recipient()}
      fallback={
        <ChannelAvatar
          channelId={props.channelId}
          class="size-4 [&_img]:rounded-full"
        />
      }
    >
      {(recipient) => (
        <UserIcon id={recipient().user_id} isDeleted={false} size="sm" />
      )}
    </Show>
  );
}
