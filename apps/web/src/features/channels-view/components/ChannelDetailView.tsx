import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  ChannelDetail,
  ChannelDetailTopBar,
} from '@channel/Channel/ChannelDetail';
import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { ChannelEntity } from '@entity';

/** Adapts a resolved conversation and navigation intent to the shared surface. */
export function ChannelDetailView(props: {
  channel: ChannelEntity;
  target?: ChannelTargetRequest;
}) {
  const panel = useSplitPanelOrThrow();
  useBlockEntityCommands({
    id: props.channel.id,
    scopeId: panel.splitHotkeyScope,
    resolveEntity: () => props.channel,
  });

  return (
    <ChannelDetail
      channelId={props.channel.id}
      target={props.target}
      fallbackName={props.channel.name}
      autofocus={false}
    >
      {(channel) => (
        <ChannelDetailTopBar
          channelId={channel.channelId}
          fallbackName={props.channel.name}
        />
      )}
    </ChannelDetail>
  );
}
