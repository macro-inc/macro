import { withChannelTabIcons } from '@channel/Channel/channel-tab-icons';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { ChannelTopIcon } from '@channel/components/ChannelTopIcon';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ChannelParticipant } from '@queries/channel/types';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';
import { type TabOption, Tabs } from '@ui';
import { Show } from 'solid-js';

type TopProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
  channelName: string;
  channelId: string;
};

type ChannelTopLeftProps = TopProps & {
  lockRename?: boolean;
  tabs?: readonly TabOption<ChannelTabId>[];
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

  const hasTabsMenu = () => !!(props.tabs?.length && props.onTabChange);

  return (
    <SplitHeaderLeft>
      <HeaderIsland class="shrink">
        <div class="ph-no-capture z-split-header-content relative flex items-center gap-2 max-w-full h-full shrink min-w-15">
          <ChannelTopIcon
            channelId={props.channelId}
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
      <Show when={!isTouchDevice() && hasTabsMenu() && props.activeTab}>
        <CollapsibleHeaderItem
          id="channel-tabs"
          priority={1}
          containerClass="ph-no-capture min-w-0 shrink-0 h-full mx-2"
        >
          {(isCollapsed) => (
            <Tabs
              aria-label="Channel sections"
              options={
                isCollapsed()
                  ? withChannelTabIcons(props.tabs ?? [])
                  : (props.tabs ?? [])
              }
              iconOnly={isCollapsed()}
              value={props.activeTab}
              onChange={(value) => props.onTabChange?.(value)}
            />
          )}
        </CollapsibleHeaderItem>
      </Show>
    </SplitHeaderLeft>
  );
}
