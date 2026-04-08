import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { SplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { UserIcon } from '@core/component/UserIcon';
import HashIcon from '@icon/regular/hash.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { ChannelTypeEnum } from '@service-comms/client';
import { useUserId } from '@core/context/user';
import { Show } from 'solid-js';
import { Tabs, type TabItem } from '@core/component/Tabs';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';

type TopIconProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
};

function TopIcon(props: TopIconProps) {
  const userId = useUserId();
  const recipient = () => {
    return props.participants.find((p) => p && p.user_id !== userId());
  };

  return (
    <Show
      when={props.channelType === ChannelTypeEnum.DirectMessage && recipient()}
      fallback={<HashIcon class="w-4 h-4" />}
    >
      {(recipient) => {
        return (
          <UserIcon id={recipient().user_id} isDeleted={false} size="xs" />
        );
      }}
    </Show>
  );
}

type TopProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
  channelName: string;
  channelId: string;
};

type ChannelTopLeftProps = TopProps & {
  lockRename?: boolean;
  tabs?: readonly TabItem[];
  activeTab?: ChannelTabId;
  onTabChange?: (value: ChannelTabId) => void;
};

export function ChannelTopLeft(props: ChannelTopLeftProps) {
  const blockId = useBlockId();
  const channelName = useChannelName(
    blockId,
    props.channelName ?? 'New Channel'
  );

  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex gap-3 justify-start items-center min-w-0">
        <div class="ph-no-capture z-3 relative flex items-center gap-2 max-w-full h-full shrink min-w-0">
          <TopIcon
            channelType={props.channelType}
            participants={props.participants}
          />
          <SplitLabel
            label={channelName() ?? 'New Channel'}
            id={props.channelId}
            itemType="channel"
            lockRename={props.lockRename}
          />
        </div>
        <Show when={props.tabs && props.activeTab && props.onTabChange}>
          <div class="ph-no-capture min-w-0 shrink-0 h-full">
            <Tabs
              list={[...(props.tabs ?? [])]}
              value={props.activeTab}
              onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
            />
          </div>
        </Show>
      </div>
    </SplitHeaderLeft>
  );
}
