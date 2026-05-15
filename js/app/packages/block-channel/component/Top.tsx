import { CollapsibleHeaderItem } from '@app/component/split-layout/components/CollapsibleHeaderItem';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { SplitLabel } from '@app/component/split-layout/components/SplitLabel';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { useBlockId } from '@core/block';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelName } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import ChatTextIcon from '@icon/regular/chat-text.svg';
import HashIcon from '@icon/regular/hash.svg';
import PaperclipIcon from '@icon/regular/paperclip.svg';
import UsersIcon from '@icon/regular/users.svg';
import PhoneIcon from '@macro-icons/wide/call.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { ChannelTypeEnum } from '@service-comms/client';
import type { ChannelType } from '@service-comms/generated/models/channelType';
import { type Component, type JSX, Show } from 'solid-js';

const CHANNEL_TAB_ICONS: Record<
  string,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  messages: ChatTextIcon,
  attachments: PaperclipIcon,
  participants: UsersIcon,
  call: PhoneIcon,
};

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
      fallback={<HashIcon class="size-4 shrink-0" />}
    >
      {(recipient) => {
        return (
          <UserIcon id={recipient().user_id} isDeleted={false} size="sm" />
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

  const iconTabList = () =>
    (props.tabs ?? []).map((tab) => {
      const Icon = CHANNEL_TAB_ICONS[tab.value];
      return {
        value: tab.value,
        label: Icon ? <Icon class="size-4 touch:size-6" /> : tab.label,
      };
    });

  return (
    <SplitHeaderLeft>
      <div class="ph-no-capture z-page-overlay relative flex items-center gap-2 max-w-full h-full shrink min-w-15">
        <TopIcon
          channelType={props.channelType}
          participants={props.participants}
        />
        <SplitLabel
          label={channelName() ?? 'New Channel'}
          lockRename={props.lockRename}
          renameOverrides={{ channelType: props.channelType }}
          maxDisplayLength={48}
        />
      </div>
      <Show when={props.tabs && props.activeTab && props.onTabChange}>
        <Show
          when={!isMobile()}
          fallback={
            <div class="ph-no-capture flex items-center min-w-0 shrink-0 h-full mx-2">
              <TabsInset
                list={iconTabList()}
                value={props.activeTab}
                onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
              />
            </div>
          }
        >
          <CollapsibleHeaderItem
            id="channel-tabs"
            priority={1}
            containerClass="ph-no-capture min-w-0 shrink-0 h-full mx-2"
            expanded={() => (
              <TabsInset
                list={[...(props.tabs ?? [])]}
                value={props.activeTab}
                onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
              />
            )}
            collapsed={() => (
              <TabsInset
                list={iconTabList()}
                value={props.activeTab}
                onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
              />
            )}
          />
        </Show>
      </Show>
    </SplitHeaderLeft>
  );
}
