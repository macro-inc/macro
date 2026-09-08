import type { ChannelEntity } from '@entity';
import { ExpandedChannelsRail } from './ExpandedChannelsRail';
import { SlimChannelsRail } from './SlimChannelsRail';
import { useChannelsRailController } from './useChannelsRailController';

export function ChannelsRail(props: {
  channels: ChannelEntity[];
  mode: 'full' | 'slim';
  onModeChange: (mode: 'full' | 'slim') => void;
}) {
  const rail = useChannelsRailController({
    channels: () => props.channels,
    mode: () => props.mode,
  });

  return (
    <aside
      aria-label="Chat navigation"
      class="flex size-full min-h-0 flex-col gap-3 bg-inset pt-2"
    >
      {props.mode === 'full' ? (
        <ExpandedChannelsRail
          rail={rail}
          onCollapse={() => props.onModeChange('slim')}
        />
      ) : (
        <SlimChannelsRail
          rail={rail}
          onExpand={() => props.onModeChange('full')}
        />
      )}
    </aside>
  );
}
