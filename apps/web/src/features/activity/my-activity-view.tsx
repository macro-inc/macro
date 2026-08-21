import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import { Button } from '@ui';
import { type Component, createMemo, For, Show } from 'solid-js';
import { ActivityTimelineRow } from './activity-timeline-row';

type FeedGroup = { key: string; label: string; events: ActivityEvent[] };

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
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

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <Show
            when={groups().length > 0}
            fallback={
              <p class="px-3 py-2 text-ink-muted text-sm">
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
      </StaticMarkdownContext>
    </div>
  );
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
