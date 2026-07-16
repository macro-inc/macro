import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { LoadingBlock } from '@core/component/LoadingBlock';
import Spinner from '@phosphor/spinner.svg';
import { EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import type { TimelineFeed, TimelineItem } from './timeline-types';

type TimelineSection = {
  key: string;
  label: string;
  items: TimelineItem[];
};

/**
 * Group a newest-first item list into contiguous relative-date sections
 * (Today, Yesterday, Last 7 days, …).
 */
function sectionize(items: TimelineItem[]): TimelineSection[] {
  const sections: TimelineSection[] = [];
  for (const item of items) {
    const bucket = dateBucket(item.ts);
    const current = sections[sections.length - 1];
    if (current && current.key === bucket.key) {
      current.items.push(item);
    } else {
      sections.push({ key: bucket.key, label: bucket.label, items: [item] });
    }
  }
  return sections;
}

/**
 * Shared shell for the activity timelines: a titled, date-sectioned,
 * infinite-scrolling list of event rows. Row rendering is supplied by the
 * view so notification rows and entity-event rows keep their own components.
 */
export function TimelineView(props: {
  title: string;
  description: string;
  feed: TimelineFeed;
  renderItem: (item: TimelineItem) => JSX.Element;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const sections = createMemo(() => sectionize(props.feed.items()));

  let sentinel: HTMLDivElement | undefined;
  createEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          props.feed.fetchMore();
        }
      },
      { rootMargin: '600px' }
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-3xl flex-col px-4 pb-6 pt-8 mobile:pt-[calc(var(--mobile-content-inset-top,0px)+0.5rem)] mobile:pb-(--mobile-content-inset-bottom)">
          <h1 class="px-3 text-lg font-semibold text-ink">{props.title}</h1>
          <p class="px-3 pb-4 text-xs text-ink-muted">{props.description}</p>

          <Show
            when={!props.feed.isLoading()}
            fallback={
              <div class="py-16">
                <LoadingBlock />
              </div>
            }
          >
            <Show
              when={sections().length > 0}
              fallback={
                <EmptyStatePanel
                  centered
                  title={props.emptyTitle}
                  description={props.emptyDescription}
                />
              }
            >
              <For each={sections()}>
                {(section) => (
                  <section>
                    <div class="sticky top-0 z-10 bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted">
                      {section.label}
                    </div>
                    <ul class="flex flex-col">
                      <For each={section.items}>
                        {(item) => <li>{props.renderItem(item)}</li>}
                      </For>
                    </ul>
                  </section>
                )}
              </For>
            </Show>
          </Show>

          <div ref={sentinel} class="h-px" />
          <Show when={props.feed.isFetchingMore()}>
            <div class="flex items-center justify-center py-4 text-ink-muted">
              <Spinner class="size-4 animate-spin" />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
