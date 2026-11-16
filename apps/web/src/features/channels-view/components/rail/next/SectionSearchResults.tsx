import { t } from '@app/lib/i18n';
import { createScrollTopFade } from '@core/util/createScrollTopFade';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery, useUserTeamsQuery } from '@queries/team/teams';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { CHANNEL_SECTION_ROW_HEIGHT } from '../../../constants';
import { ChannelOption } from '../ChannelOption';
import { useChannelsRail } from '../ChannelsRailContext';
import { RailListError, RailListLoading } from '../ChannelsRailSection';
import {
  ChannelRailVirtualizer,
  type ChannelRailVirtualizerHandle,
} from './ChannelRailVirtualizer';
import type { ChannelRailSearch } from './ExpandedChannelsRail';

export function ExpandedSearchResults(props: { search: ChannelRailSearch }) {
  const rail = useChannelsRail();
  const currentTeam = useCurrentTeamQuery();
  const teams = useUserTeamsQuery();
  const teamNames = createMemo(
    () =>
      new Map(
        queryReadyGate(teams)
          ? (teams.data ?? []).map((team) => [team.id, team.name])
          : []
      )
  );
  const foreignTeamName = (teamId?: string) => {
    if (
      !teamId ||
      !queryReadyGate(currentTeam) ||
      teamId === currentTeam.data?.team.id
    )
      return;
    return teamNames().get(teamId);
  };
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  let virtualizer: ChannelRailVirtualizerHandle | undefined;
  let unregister: (() => void) | undefined;

  onCleanup(() => unregister?.());

  const channelsById = createMemo(
    () =>
      new Map(props.search.results().map((channel) => [channel.id, channel]))
  );

  const groupStarts = createMemo(() => {
    const channels = props.search.results();
    const starts = new Set<string>();
    if (channels[0]) starts.add(channels[0].id);
    const joined = channels.find((channel) => channel.isParticipant !== false);
    if (joined) starts.add(joined.id);
    return starts;
  });

  const keepMounted = () => {
    const row = rail.list.focus.item();
    if (row?.kind !== 'conversation') return [];

    const index = props.search
      .results()
      .findIndex(({ id }) => id === row.channel.id);
    return index >= 0 ? [index] : [];
  };

  const loadMoreNearEnd = () => {
    const metrics = virtualizer?.scrollMetrics();
    const source = rail.sources.search;

    if (
      metrics &&
      metrics.size - metrics.offset - metrics.viewport < 300 &&
      source.hasMore() &&
      !source.isFetching() &&
      !source.error()
    ) {
      fireAndForget(source.loadMore(), 'channels-view');
    }
  };

  createScrollTopFade(scrollRoot);

  return (
    <div
      ref={setScrollRoot}
      class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-(--sidebar-gutter)"
    >
      <Show
        when={props.search.isLoading() && props.search.results().length === 0}
      >
        <RailListLoading />
      </Show>
      <Show when={props.search.error()}>
        <RailListError retry={props.search.retry} />
      </Show>
      <ChannelRailVirtualizer
        ref={(current) => {
          unregister?.();
          unregister = undefined;
          virtualizer = current;
          if (current) unregister = rail.registerVirtualizer('search', current);
        }}
        keys={[...channelsById().keys()]}
        scrollRoot={scrollRoot()}
        scrollPadding={CHANNEL_SECTION_ROW_HEIGHT * 2}
        estimateSize={CHANNEL_SECTION_ROW_HEIGHT}
        keepMounted={keepMounted()}
        onRangeChange={loadMoreNearEnd}
      >
        {(id) => (
          <Show when={channelsById().get(id)}>
            {(channel) => (
              <>
                <Show when={groupStarts().has(id)}>
                  <div class="px-2 pt-3 pb-1 text-xs font-medium text-ink-muted">
                    {channel().isParticipant === false
                      ? t('channelSections.notJoined')
                      : t(
                          props.search.query().trim()
                            ? 'channelSections.channels'
                            : 'channelSections.recent'
                        )}
                  </div>
                </Show>
                <ChannelOption
                  channel={channel()}
                  teamName={foreignTeamName(channel().teamId)}
                />
              </>
            )}
          </Show>
        )}
      </ChannelRailVirtualizer>
      <Show
        when={
          !props.search.isLoading() &&
          !props.search.error() &&
          props.search.results().length === 0
        }
      >
        <p class="px-2 py-6 text-center text-sm text-ink-muted">
          {t('channelSections.noResults')}
        </p>
      </Show>
    </div>
  );
}
