import { activeAppLayoutSurfaces } from '@app/features/app-layout/layout-surfaces';
import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import { createMyActivityOverviewQuery } from '@queries/activity/graphql/overview';
import { Button } from '@ui';
import { type Component, createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ActionGraph } from './action-graph';
import { ActivityTimelineRow } from './activity-timeline-row';
import { TopEntities } from './top-entities';

type FeedGroup = { key: string; label: string; events: ActivityEvent[] };

/** The soup list inset shared by section headers, feed rows, and the overview. */
const INSET_CLASS = 'mx-1 w-[calc(100%-0.5rem)]';

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
  const hasExperimentalActivityView = () =>
    activeAppLayoutSurfaces()?.ActivityView !== undefined;
  const overview = createMyActivityOverviewQuery({
    enabled: () => !hasExperimentalActivityView(),
  });
  const feed = createMyActivityQuery({ enabled: () => true });
  const groups = createMemo<FeedGroup[]>(() => {
    const out: FeedGroup[] = [];
    for (const event of feed.data ?? []) {
      const bucket = dateBucket(event.occurredAt);
      const last = out[out.length - 1];
      if (last?.key === bucket.key) {
        last.events.push(event);
      } else {
        out.push({ ...bucket, events: [event] });
      }
    }
    return out;
  });

  const ExperimentalFeedContent = () => (
    <StaticMarkdownContext>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <Show
          when={groups().length > 0}
          fallback={
            <p class="px-2 py-2 text-sm text-ink-muted">
              {feed.isLoading
                ? 'Loading…'
                : feed.isError
                  ? 'Activity is unavailable right now. Try again in a moment.'
                  : 'No activity yet.'}
            </p>
          }
        >
          <FeedGroups
            groups={groups()}
            row={ActivityTimelineRow}
            experimental
          />
          <Show when={feed.hasNextPage}>
            <div class="flex justify-center py-2">
              <Button
                variant="ghost"
                class="rounded-full"
                onClick={() => void feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          </Show>
        </Show>
      </div>
    </StaticMarkdownContext>
  );

  const ClassicActivityContent = () => (
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
            <Show
              when={groups().length > 0}
              fallback={
                <p class={`${INSET_CLASS} px-2 py-2 text-ink-muted text-sm`}>
                  {feed.isLoading
                    ? 'Loading…'
                    : feed.isError
                      ? 'Activity is unavailable right now. Try again in a moment.'
                      : 'No activity yet.'}
                </p>
              }
            >
              <FeedGroups groups={groups()} row={ActivityTimelineRow} />
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
            </Show>
          </div>
        </div>
      </StaticMarkdownContext>
    </div>
  );

  return (
    <Show
      when={activeAppLayoutSurfaces()?.ActivityView}
      fallback={<ClassicActivityContent />}
    >
      {(ActivityView) => (
        <Dynamic
          component={ActivityView()}
          events={feed.data ?? []}
          isLoading={feed.isLoading}
          isError={feed.isError}
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          onFetchNextPage={() => void feed.fetchNextPage()}
        >
          <ExperimentalFeedContent />
        </Dynamic>
      )}
    </Show>
  );
}

function FeedGroups(props: {
  groups: FeedGroup[];
  row: Component<{
    event: ActivityEvent;
    experimental?: boolean;
  }>;
  experimental?: boolean;
}) {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <Show
            when={props.experimental}
            fallback={<SoupSectionHeader>{group.label}</SoupSectionHeader>}
          >
            <div class="flex items-center gap-2 px-2 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted">
              <span class="shrink-0">{group.label}</span>
              <span class="h-px min-w-4 flex-1 bg-edge-muted/80" />
            </div>
          </Show>
          <For each={group.events}>
            {(event) => (
              <props.row
                event={event}
                experimental={props.experimental}
              />
            )}
          </For>
        </>
      )}
    </For>
  );
}
