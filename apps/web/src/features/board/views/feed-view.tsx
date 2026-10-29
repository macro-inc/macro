import { useListInteractions } from '@app/components/list';
import { ListViewport } from '@app/components/list/ListViewport';
import { t } from '@app/lib/i18n';
import { startOfDay } from 'date-fns';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { VirtualizerHandle } from 'virtua/solid';
import {
  DigestRow,
  FeedDayHeading,
  type FeedDensity,
  FeedEnd,
  type FeedEndState,
  FeedItemFrame,
  type FeedItemProps,
  FeedSkeleton,
  HeadlineRow,
  ThreadCard,
} from '../components/feed-rows';
import { useBoard } from '../context/board-context';
import type { FeedRow } from '../core/feed';
import type { BoardSceneView } from '../primitives/board-scene';
import { createFeedList } from '../primitives/feed-list';
import { BoardStatus, itemLabel, type VariantProps } from './variant-shared';

const DENSITY_ROWS: Record<FeedDensity, Component<FeedItemProps>> = {
  headlines: HeadlineRow,
  digest: DigestRow,
  threads: ThreadCard,
};

/** The row after the last item: older activity loading, on offer, or none. */
const END_ROW = { kind: 'end', key: 'end' } as const;
type ListRow = FeedRow | typeof END_ROW;

/** How close to the end scrolling starts loading older activity. */
const NEAR_END_PX = 400;

/** A focused control keeps Enter for itself. */
const CONTROL_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';

/**
 * Every item as a list you scroll, newest first under day headings, that
 * loads older activity as you near its end. The densities differ only in
 * how much of each conversation a row shows. Rows open in the board's
 * modal; J and K move between them.
 */
function FeedView(props: VariantProps & { density: FeedDensity }) {
  const board = useBoard();
  // Headings change at midnight, not on every tick of the clock.
  const today = createMemo(() => startOfDay(board.now()).getTime());
  const feed = createFeedList({
    items: props.scene.all,
    now: today,
    older: board.source.older,
    onOpen: props.onOpen,
  });
  const list = feed.list;
  const rows = createMemo((): ListRow[] => [...feed.rows(), END_ROW]);
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  const idPrefix = `board-feed-${createUniqueId()}`;
  const rowId = (key: string) => `${idPrefix}-${key}`;

  const activeRowId = () => {
    const key = list.focus.key();
    return key === undefined ? undefined : rowId(key);
  };

  const focusedRow = () => {
    const index = list.focus.index();
    return index < 0 ? -1 : feed.rowIndex(index);
  };

  const endState = (): FeedEndState => {
    if (feed.loadingOlder()) return 'loading';
    return feed.hasOlder() ? 'more' : 'end';
  };

  // Only drawn while there is nothing to list; loading draws rows to come.
  const status = (): BoardSceneView => {
    const state = board.source.state();
    if (state === 'loading') return { t: 'loading' };
    if (state === 'error') return { t: 'error' };
    return { t: 'empty', hidden: 0 };
  };

  const checkNearEnd = () => {
    const handle = virtualizer();
    if (!handle || handle.viewportSize === 0) return;
    const remaining =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    if (remaining < NEAR_END_PX) feed.loadOlder();
  };

  // A page that doesn't fill the viewport can't be scrolled, so check again
  // whenever rows arrive or a load finishes.
  createEffect(
    on([rows, feed.loadingOlder], () => {
      const frame = requestAnimationFrame(checkNearEnd);
      onCleanup(() => cancelAnimationFrame(frame));
    })
  );

  if (props.hotkeys) {
    const hotkeys = props.hotkeys;
    useListInteractions({
      controller: list,
      scopeId: hotkeys.scopeId,
      enabled: hotkeys.enabled,
      scrollHandle: () => {
        const handle = virtualizer();
        if (!handle) return undefined;
        return {
          // Focus counts items; the virtualizer counts headings too. The
          // first item brings its heading into view with it.
          scrollToIndex: (index, options) =>
            handle.scrollToIndex(
              index === 0 ? 0 : feed.rowIndex(index),
              options
            ),
        };
      },
      conditions: {
        extendSelection: () => false,
        toggleSelection: () => false,
        toggleAllVisible: () => false,
        clearSelection: () => false,
      },
      navigation: {
        onNavigate: (event) => {
          if (event.kind !== 'move' || event.direction !== 1) return;
          const fromEnd = event.result
            ? list.items.count() - event.result.index - 1
            : 0;
          if (fromEnd <= 3) feed.loadOlder();
        },
      },
      activation: {
        shouldHandleKeyEvent: (event) =>
          !(
            event?.target instanceof Element &&
            event.target.closest(CONTROL_SELECTOR)
          ),
      },
    });
  }

  return (
    <Show
      when={props.scene.all().length > 0}
      fallback={
        <Show
          when={status().t === 'loading'}
          fallback={<BoardStatus view={status()} onRetry={props.onRetry} />}
        >
          <FeedSkeleton density={props.density} label={t('board.loading')} />
        </Show>
      }
    >
      <div
        role="grid"
        aria-label={t('board.activity')}
        aria-busy={feed.loadingOlder()}
        aria-activedescendant={activeRowId()}
        tabIndex={0}
        class="flex size-full min-h-0 flex-col outline-none"
      >
        <ListViewport
          ref={setVirtualizer}
          items={rows()}
          focusedIndex={focusedRow()}
          onScroll={checkNearEnd}
        >
          {(row) => (
            <Switch>
              <Match when={row.kind === 'day' ? row : undefined}>
                {(heading) => (
                  <FeedDayHeading
                    day={heading().day}
                    first={feed.rows()[0]?.key === heading().key}
                    density={props.density}
                  />
                )}
              </Match>
              <Match when={row.kind === 'item' ? row : undefined}>
                {(entry) => (
                  <FeedItemFrame
                    id={rowId(entry().key)}
                    label={itemLabel(entry().item, false)}
                    density={props.density}
                    onHover={() =>
                      list.focus.set(entry().key, { reason: 'hover' })
                    }
                    onOpen={() =>
                      list.activate.key(entry().key, { reason: 'pointer' })
                    }
                  >
                    <Dynamic
                      component={DENSITY_ROWS[props.density]}
                      item={entry().item}
                      now={board.now()}
                      freshness={props.scene.freshness(entry().key)}
                      highlighted={list.focus.key() === entry().key}
                      Avatar={board.Avatar}
                    />
                  </FeedItemFrame>
                )}
              </Match>
              <Match when={row.kind === 'end'}>
                <FeedEnd
                  state={endState()}
                  density={props.density}
                  onLoadOlder={feed.loadOlder}
                />
              </Match>
            </Switch>
          )}
        </ListViewport>
      </div>
    </Show>
  );
}

/** V2A Headlines: one line per conversation. */
export function HeadlinesFeed(props: VariantProps) {
  return <FeedView {...props} density="headlines" />;
}

/** V2B Digest: the latest message from each, and who said it. */
export function DigestFeed(props: VariantProps) {
  return <FeedView {...props} density="digest" />;
}

/** V2C Threads: each conversation's recent messages in full. */
export function ThreadsFeed(props: VariantProps) {
  return <FeedView {...props} density="threads" />;
}
