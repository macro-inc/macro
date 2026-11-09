import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams } from '@app/lib/split-router';
import {
  ChannelDetail,
  ChannelDetailTopBar,
} from '@channel/Channel/ChannelDetail';
import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import { arrivalFocusesComposer } from '@channel/composer-arrival-focus';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { ChannelEntity } from '@entity';
import { channelsSearch } from '../channels-route';
import { useChannelsView } from '../channels-view-context';

/** Adapts a resolved conversation and navigation intent to the shared surface. */
export function ChannelDetailView(props: {
  channel: ChannelEntity;
  target?: ChannelTargetRequest;
}) {
  const panel = useSplitPanelOrThrow();
  const { composerFocusRequest, focusRailRow } = useChannelsView();
  const [search] = createSearchParams(channelsSearch);
  useBlockEntityCommands({
    id: props.channel.id,
    scopeId: panel.splitHotkeyScope,
    resolveEntity: () => props.channel,
  });

  const focusRequest = () => {
    const request = composerFocusRequest();
    return request?.channelId === props.channel.id ? request.id : 0;
  };

  return (
    <ChannelDetail
      channelId={props.channel.id}
      target={props.target}
      navigationRequest={search.seek}
      fallbackName={props.channel.name}
      // Read as each conversation's composer connects: this view stays
      // mounted while the rail switches conversations.
      autofocus={arrivalFocusesComposer(panel.handle)}
      composerFocusRequest={focusRequest()}
      onEscapeToList={() => focusRailRow(props.channel.id)}
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
