import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { LoadingBlock } from '@core/component/LoadingBlock';
import Spinner from '@phosphor/spinner.svg';
import { EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
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

function rowIdentity(row: TimelineRow): string {
  let identity = `${row.key}:${row.ts}`;
  for (const item of row.items) identity += `,${item.id}`;
  return identity;
}

/**
 * One scrolling activity pane: a titled, date-sectioned, infinite feed of
 * compact event rows. Row rendering is supplied by the caller; `trailing`
 * renders at the header's right edge (e.g. the Me/Team toggle).
 */
export function TimelinePane(props: {
  title: string;
  description: string;
  feed: TimelineFeed;
  renderRow: (row: TimelineRow) => JSX.Element;
  emptyTitle: string;
  emptyDescription: string;
  trailing?: JSX.Element;
}) {
  // Row and section objects are rebuilt on every feed update; reusing the
  // previous object when a row's identity is unchanged lets <For> keep its
  // DOM. Without this, each loaded page re-rendered every existing row —
  // hundreds of markdown previews — which compounded until the pane froze.
  let prevRows = new Map<string, TimelineRow>();
  const rows = createMemo((): TimelineRow[] => {
    const next = collapseTimeline(props.feed.items());
    const reused = next.map((row) => {
      const identity = rowIdentity(row);
      const prev = prevRows.get(identity);
      return prev ?? row;
    });
    prevRows = new Map(reused.map((row) => [rowIdentity(row), row]));
    return reused;
  });

  let prevSections = new Map<string, TimelineSection>();
  const sections = createMemo((): TimelineSection[] => {
    const next = sectionize(rows());
    const reused = next.map((section) => {
      const prev = prevSections.get(section.key);
      const unchanged =
        prev &&
        prev.rows.length === section.rows.length &&
        prev.rows.every((row, index) => row === section.rows[index]);
      return unchanged ? prev : section;
    });
    prevSections = new Map(reused.map((section) => [section.key, section]));
    return reused;
  });

  // Load-more must keep firing while the sentinel stays in view:
  // IntersectionObserver only reports threshold *crossings*, so if a loaded
  // page doesn't push the sentinel out of the margin the observer alone
  // never fires again and the feed stalls. Track visibility as a signal and
  // re-attempt whenever a fetch settles while it is still visible.
  const [sentinelVisible, setSentinelVisible] = createSignal(false);

  let sentinel: HTMLDivElement | undefined;
  createEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setSentinelVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '600px' }
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    if (!sentinelVisible()) return;
    if (props.feed.isLoading() || props.feed.isFetchingMore()) return;
    if (!props.feed.hasMore()) return;
    props.feed.fetchMore();
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="shrink-0 flex items-start justify-between gap-3 px-6 pb-2 pt-5">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-ink">{props.title}</h2>
          <p class="text-xs text-ink-muted">{props.description}</p>
        </div>
        <Show when={props.trailing}>
          <div class="shrink-0">{props.trailing}</div>
        </Show>
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
