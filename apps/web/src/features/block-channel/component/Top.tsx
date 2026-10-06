import { ChannelTopIcon } from '@channel/components/ChannelTopIcon';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import { useChannelName } from '@core/context/channels';
import type { ChannelParticipant } from '@queries/channel/types';
import type { ChannelType } from '@service-storage/generated/schemas/channelType';

type TopProps = {
  channelType: ChannelType;
  participants: ChannelParticipant[];
  channelName: string;
  channelId: string;
};

type ChannelTopLeftProps = TopProps & {
  lockRename?: boolean;
};

export function ChannelTopLeft(props: ChannelTopLeftProps) {
  const panel = useSplitPanelOrThrow();
  const blockId = useBlockId();
  const channelName = useChannelName(
    blockId,
    props.channelName ?? 'New Channel'
  );

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
    </SplitHeaderLeft>
  );
}
