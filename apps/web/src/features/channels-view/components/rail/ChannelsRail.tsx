import type { ChannelEntity } from '@entity';
import { ChannelsRailProvider } from './ChannelsRailContext';
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
    onModeChange: (mode) => props.onModeChange(mode),
  });

  return (
    <ChannelsRailProvider value={rail}>
      <aside
        aria-label="Chat navigation"
        class="flex size-full min-h-0 flex-col gap-3 bg-inset pt-2"
      >
        {props.mode === 'full' ? (
          <ExpandedChannelsRail />
        ) : (
          <SlimChannelsRail />
        )}
      </aside>
    </ChannelsRailProvider>
  );
}
