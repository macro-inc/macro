import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { createSearchParams } from '@app/lib/split-router';
import {
  ChannelDetail,
  ChannelDetailTopBar,
} from '@channel/Channel/ChannelDetail';
import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { shouldAutofocusNavigation } from '@components/app/split-layout/should-autofocus-navigation';
import type { ChannelEntity } from '@entity';
import { channelsSearch } from '../channels-route';
import { useChannelsView } from '../channels-view-context';

/** Adapts a resolved conversation and navigation intent to the shared surface. */
export function ChannelDetailView(props: {
  channel: ChannelEntity;
  target?: ChannelTargetRequest;
}) {
  const panel = useSplitPanelOrThrow();
  const { composerFocusRequest } = useChannelsView();
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

  // Read as each conversation's composer connects: this view stays mounted
  // while the rail switches conversations. Cmd+K arrivals and rail clicks or
  // Enter focus it; arrowing through the rail and Back/Forward leave focus.
  const autofocus = () => {
    const cause = panel.handle.lastNavigationCause();
    if (shouldAutofocusNavigation(panel.handle.lastNavigationSource(), cause))
      return true;
    return focusRequest() > 0 && !cause.startsWith('history-');
  };

  return (
    <ChannelDetail
      channelId={props.channel.id}
      target={props.target}
      navigationRequest={search.seek}
      fallbackName={props.channel.name}
      autofocus={autofocus()}
      composerFocusRequest={focusRequest()}
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
