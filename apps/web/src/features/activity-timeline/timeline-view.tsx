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
import { collapseTimeline, type TimelineRow } from './collapse';
import type { TimelineFeed } from './timeline-types';

type TimelineSection = {
  key: string;
  label: string;
  rows: TimelineRow[];
};

/**
 * Collapse repeat runs, then group the rows into contiguous relative-date
 * sections (Today, Yesterday, Last 7 days, …).
 */
function sectionize(rows: TimelineRow[]): TimelineSection[] {
  const sections: TimelineSection[] = [];
  for (const row of rows) {
    const bucket = dateBucket(row.ts);
    const current = sections[sections.length - 1];
    if (current && current.key === bucket.key) {
      current.rows.push(row);
    } else {
      sections.push({ key: bucket.key, label: bucket.label, rows: [row] });
    }
  }
  return sections;
}

/**
 * One scrolling activity pane: a titled, date-sectioned, infinite feed of
 * compact event rows. Row rendering is supplied by the caller.
 */
export function TimelinePane(props: {
  title: string;
  description: string;
  feed: TimelineFeed;
  renderRow: (row: TimelineRow) => JSX.Element;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const sections = createMemo(() =>
    sectionize(collapseTimeline(props.feed.items()))
  );

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
      <div class="shrink-0 px-6 pb-2 pt-5">
        <h2 class="text-base font-semibold text-ink">{props.title}</h2>
        <p class="text-xs text-ink-muted">{props.description}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-2xl flex-col px-3 pb-10 mobile:pb-(--mobile-content-inset-bottom)">
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
                  <section class="mt-20 first:mt-4">
                    <div class="px-3 pb-3 text-sm font-semibold text-ink">
                      {section.label}
                    </div>
                    <ul class="flex flex-col">
                      <For each={section.rows}>
                        {(row) => <li>{props.renderRow(row)}</li>}
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
