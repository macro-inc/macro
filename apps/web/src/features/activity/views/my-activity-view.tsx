import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { match } from 'ts-pattern';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { ActionGraph } from '../components/action-graph';
import { ActivityTimelineRow as ActivityTimelineRowView } from '../components/activity-timeline-row';
import { TopEntitiesSection, TopEntityChip } from '../components/top-entities';
import {
  type OpenEntityTarget,
  useActivityContext,
} from '../context/activity-context';
import type { ActivityEvent, ActivityTopEntity } from '../core/event';
import { type FeedRow, shouldFetchMore } from '../core/feed-rows';
import { placeholderOverview } from '../core/placeholder-overview';
import { createActorName } from '../primitives/actor-name';
import { createEntityOpener } from '../primitives/entity-opener';
import {
  createMyActivityState,
  type MyActivityState,
} from '../primitives/my-activity';
import { ActivityTimelineRow } from './activity-timeline-row';

/** Pixels of rows virtua keeps mounted beyond the viewport on each side. */
const FEED_BUFFER_PX = 400;

function OverviewInset(props: { children: JSX.Element }) {
  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] min-w-0 flex-col gap-2 pb-2">
      {props.children}
    </div>
  );
}

function FeedStatus(props: { children: JSX.Element }) {
  return (
    <p class="mx-1 w-[calc(100%-0.5rem)] px-2 py-2 text-ink-muted text-sm">
      {props.children}
    </p>
  );
}

/**
 * The user's own activity, newest first, as one virtualized list with the
 * overview card as its first row. Scrolling near the end fetches the next
 * page. Reads `ActivityContext`; the host decides what a row click opens.
 */
export function MyActivityView(props: {
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const state = createMyActivityState(context);
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  let handle: VirtualizerHandle | undefined;

  const fetchMoreIfNearEnd = (offset: number) => {
    if (!handle) return;
    if (
      shouldFetchMore({
        scrollSize: handle.scrollSize,
        viewportSize: handle.viewportSize,
        offset,
      })
    ) {
      state.loadMore();
    }
  };

  // A page that does not fill the viewport never scrolls, so re-check once
  // virtua has laid out the new rows.
  createEffect(
    on(state.rows, () => {
      const frame = requestAnimationFrame(() =>
        fetchMoreIfNearEnd(handle?.scrollOffset ?? 0)
      );
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div ref={setScroller} class="min-h-0 flex-1 overflow-y-auto py-1">
          <div class="mx-auto w-full max-w-[1000px]">
            <Virtualizer
              data={state.rows()}
              scrollRef={scroller()}
              ref={(next) => {
                handle = next;
              }}
              bufferSize={FEED_BUFFER_PX}
              onScroll={fetchMoreIfNearEnd}
            >
              {(row) => (
                <FeedRowView row={row} state={state} onOpen={props.onOpen} />
              )}
            </Virtualizer>
          </div>
        </div>
      </StaticMarkdownContext>
    </div>
  );
}

function FeedRowView(props: {
  row: FeedRow;
  state: MyActivityState;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  return match(props.row)
    .with({ kind: 'overview' }, () => (
      <OverviewRow state={props.state} onOpen={props.onOpen} />
    ))
    .with({ kind: 'day' }, (row) => (
      <SoupSectionHeader>{row.label}</SoupSectionHeader>
    ))
    .with({ kind: 'event' }, (row) => (
      <NamedActivityRow event={row.event} onOpen={props.onOpen} />
    ))
    .with({ kind: 'status', status: 'loading' }, () => (
      <FeedStatus>Loading…</FeedStatus>
    ))
    .with({ kind: 'status', status: 'error' }, () => (
      <FeedStatus>
        Activity is unavailable right now. Try again in a moment.
      </FeedStatus>
    ))
    .with({ kind: 'status', status: 'empty' }, () => (
      <FeedStatus>No activity yet.</FeedStatus>
    ))
    .with({ kind: 'tail' }, () => <FeedTail state={props.state} />)
    .exhaustive();
}

function FeedTail(props: { state: MyActivityState }) {
  const loadingMore = () => {
    const feed = props.state.feed();
    return feed.t === 'ready' && feed.loadingMore;
  };
  return (
    <div
      class="flex h-10 items-center justify-center text-ink-muted text-sm"
      aria-live="polite"
      data-activity-feed-tail
    >
      <Show when={loadingMore()}>Loading…</Show>
    </div>
  );
}

function OverviewRow(props: {
  state: MyActivityState;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const overview = () => {
    const current = props.state.overview();
    return current.t === 'ready' ? current.overview : undefined;
  };
  return (
    <Show
      when={overview()}
      fallback={
        <OverviewInset>
          <Show
            when={props.state.overview().t === 'error'}
            fallback={
              <ActionGraph
                overview={placeholderOverview(new Date())}
                skeleton
              />
            }
          >
            <p class="px-2 py-1 text-ink-extra-muted text-xs">
              Activity overview is unavailable right now.
            </p>
          </Show>
        </OverviewInset>
      }
    >
      {(overview) => (
        <OverviewInset>
          <ActionGraph overview={overview()} />
          <Show when={overview().topEntities.length > 0}>
            <TopEntitiesSection>
              <For each={overview().topEntities}>
                {(entity) => (
                  <OpenableTopEntityChip
                    entity={entity}
                    onOpen={props.onOpen}
                  />
                )}
              </For>
            </TopEntitiesSection>
          </Show>
        </OverviewInset>
      )}
    </Show>
  );
}

// Rows mount as the user scrolls, and a row whose entity preview is still a
// cold query suspends the nearest boundary. Each row carries its own so the
// pane boundary never re-inserts the scroller, which would reset its scroll
// position to the top.
function NamedActivityRow(props: {
  event: ActivityEvent;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const name = createActorName(context, () => props.event.actorId);
  return (
    <Suspense
      fallback={
        <ActivityTimelineRowView event={props.event} actorName={name()} />
      }
    >
      <ActivityTimelineRow
        event={props.event}
        actorName={name()}
        onOpen={props.onOpen}
      />
    </Suspense>
  );
}

function OpenableTopEntityChip(props: {
  entity: ActivityTopEntity;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  return (
    <Suspense fallback={<TopEntityChip entity={props.entity} />}>
      <ResolvedTopEntityChip entity={props.entity} onOpen={props.onOpen} />
    </Suspense>
  );
}

function ResolvedTopEntityChip(props: {
  entity: ActivityTopEntity;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const opener = createEntityOpener(
    context,
    () => props.entity.entityId,
    () => props.entity.entityType,
    props.onOpen
  );
  return (
    <TopEntityChip
      entity={props.entity}
      display={opener()?.display}
      rowProps={opener()?.handlers}
    />
  );
}
