import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { type Component, createMemo, For, Match, Show, Switch } from 'solid-js';
import { createMyActivityQuery } from '../adapters/feed-query';
import { createMyActivityOverviewQuery } from '../adapters/overview-query';
import type { ActivityEvent } from '../domain/event';
import { type FeedGroup, groupEventsByDay } from '../domain/group-events';
import { ActionGraph } from '../ui/action-graph';
import { ActivityTimelineRow } from '../ui/activity-timeline-row';
import { TopEntities } from '../ui/top-entities';
import { useActorDisplayName } from './resolve-actor-name';

type FeedView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; groups: FeedGroup[] };

/** The soup list inset shared by section headers, feed rows, and the overview. */
const INSET_CLASS = 'mx-1 w-[calc(100%-0.5rem)]';

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
  const overview = createMyActivityOverviewQuery({ enabled: () => true });
  const feed = createMyActivityQuery({ enabled: () => true });
  const groups = createMemo(() => groupEventsByDay(feed.data ?? []));
  const feedView = createMemo<FeedView>(() => {
    if (groups().length > 0) return { t: 'ready', groups: groups() };
    if (feed.isLoading) return { t: 'loading' };
    if (feed.isError) return { t: 'error' };
    return { t: 'empty' };
  });

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <div class="mx-auto w-full max-w-[1000px]">
            <div class={`${INSET_CLASS} flex min-w-0 flex-col gap-2 pb-2`}>
              <Show
                when={overview.data}
                fallback={
                  <p class="px-2 py-1 text-ink-extra-muted text-xs">
                    {overview.isError
                      ? 'Activity overview is unavailable right now.'
                      : 'Loading activity overview…'}
                  </p>
                }
              >
                {(data) => <ActionGraph overview={data()} />}
              </Show>
            </div>
            <Show when={overview.data}>
              {(data) => <TopEntities entities={data().topEntities} />}
            </Show>
            <Switch>
              <Match
                when={(() => {
                  const current = feedView();
                  return current.t === 'ready' ? current : undefined;
                })()}
              >
                {(ready) => (
                  <>
                    <FeedGroups
                      groups={ready().groups}
                      row={NamedActivityRow}
                    />
                    <Show when={feed.hasNextPage}>
                      <div class="flex justify-center py-2">
                        <Button
                          variant="ghost"
                          onClick={() => void feed.fetchNextPage()}
                          disabled={feed.isFetchingNextPage}
                        >
                          {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
                        </Button>
                      </div>
                    </Show>
                  </>
                )}
              </Match>
              <Match when={feedView().t === 'loading'}>
                <p class={`${INSET_CLASS} px-2 py-2 text-ink-muted text-sm`}>
                  Loading…
                </p>
              </Match>
              <Match when={feedView().t === 'error'}>
                <p class={`${INSET_CLASS} px-2 py-2 text-ink-muted text-sm`}>
                  Activity is unavailable right now. Try again in a moment.
                </p>
              </Match>
              <Match when={feedView().t === 'empty'}>
                <p class={`${INSET_CLASS} px-2 py-2 text-ink-muted text-sm`}>
                  No activity yet.
                </p>
              </Match>
            </Switch>
          </div>
        </div>
      </StaticMarkdownContext>
    </div>
  );
}

function NamedActivityRow(props: { event: ActivityEvent }) {
  const name = useActorDisplayName(() => props.event.actorId);
  return <ActivityTimelineRow event={props.event} actorName={name()} />;
}

function FeedGroups(props: {
  groups: FeedGroup[];
  row: Component<{ event: ActivityEvent }>;
}) {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <SoupSectionHeader>{group.label}</SoupSectionHeader>
          <For each={group.events}>
            {(event) => <props.row event={event} />}
          </For>
        </>
      )}
    </For>
  );
}
