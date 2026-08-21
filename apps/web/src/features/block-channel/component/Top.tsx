import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { UserIcon } from '@core/component/UserIcon';
import { useChannelName } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PhoneIcon from '@icon/wide-call.svg';
import ChannelIcon from '@icon/wide-channel.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import UsersIcon from '@phosphor/users.svg';
import type { ChannelParticipant } from '@queries/channel/types';
import { ChannelTypeEnum } from '@service-storage/client';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import { type Component, type JSX, Show } from 'solid-js';

export const CHANNEL_TAB_ICONS: Record<
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
      fallback={<ChannelIcon class="size-4 shrink-0" />}
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
  const panel = useSplitPanelOrThrow();
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

  const hasTabsMenu = () => !!(props.tabs?.length && props.onTabChange);

  return (
    <SplitHeaderLeft>
      <HeaderIsland class="shrink">
        <div class="ph-no-capture z-split-header-content relative flex items-center gap-2 max-w-full h-full shrink min-w-15">
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
          <div
            class="shrink-0 flex items-center h-full"
            ref={(ref) => panel.setTitleFileMenuRef(ref)}
          />
        </div>
      </HeaderIsland>
      {/* Mobile has no room for inline tabs; the title file menu carries the
          tab links there instead (see NewChannelBlockAdapter). */}
      <Show when={!isTouchDevice() && hasTabsMenu() && props.activeTab}>
        <CollapsibleHeaderItem
          id="channel-tabs"
          priority={1}
          containerClass="ph-no-capture min-w-0 shrink-0 h-full mx-2"
        >
          {(isCollapsed) => (
            <TabsInset
              list={isCollapsed() ? iconTabList() : [...(props.tabs ?? [])]}
              value={props.activeTab}
              onChange={(value) => props.onTabChange?.(value as ChannelTabId)}
            />
          )}
        </CollapsibleHeaderItem>
      </Show>
    </SplitHeaderLeft>
  );
}
