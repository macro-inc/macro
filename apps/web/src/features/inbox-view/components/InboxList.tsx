import '@entity/composed/ListEntity.css';
import {
  createListController,
  type ListActivation,
  useListInteractions,
} from '@app/components/list';
import {
  InboxCardLayout,
  toInboxCardDisplayItem,
} from '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts';
import {
  buildFlatSoupRows,
  createSoupLoadMoreRow,
  type SoupRow,
} from '@app/features/soup';
import { PullToRefresh } from '@components/app/mobile/PullToRefresh';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useChannelsContext } from '@core/context/channels';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData, WithNotification } from '@entity';
import CaretDownIcon from '@phosphor/caret-down.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { scopeThreadNotifications } from '../../next-soup/soup-view/views/inbox/utils';
import type { InboxViewState } from '../create-inbox-view-state';
import type { InboxQuery } from '../queries/use-inbox-query';
import { InboxEmptyState } from './InboxEmptyState';

type InboxListRow = SoupRow<WithNotification<EntityData>>;
type ActivationMetadata = { event?: MouseEvent; newSplit?: boolean };

type InboxListProps = {
  state: InboxViewState;
  source: InboxQuery;
  onOpen: (
    entity: WithNotification<EntityData>,
    options: { newSplit: boolean; replacePair: boolean }
  ) => void;
};

/** Compact Inbox-card list used by the Activity-layout Inbox workspace. */
export function InboxList(props: InboxListProps) {
  const panel = useSplitPanelOrThrow();
  const channels = useChannelsContext();

  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();

  const rows = createMemo<InboxListRow[]>(() => {
    const result: InboxListRow[] = buildFlatSoupRows([
      ...props.source.entities(),
    ]);

    if (props.source.hasNextPage()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `inbox:${props.state.tab()}`,
          isLoading: props.source.loadingMore(),
        })
      );
    }

    return result;
  });
  function displayItem(entity: WithNotification<EntityData>) {
    const scoped = scopeThreadNotifications(entity);
    if (scoped.type !== 'channel_thread') {
      return toInboxCardDisplayItem(scoped);
    }

    const name = channels.channelsById()[scoped.channelId]?.name;
    return toInboxCardDisplayItem(name ? { ...scoped, name } : scoped);
  }

  function activate({
    item,
    metadata,
  }: ListActivation<InboxListRow, ActivationMetadata>) {
    if (item.kind === 'load-more') {
      if (item.isLoading) return;

      void props.source.loadMore();
      return;
    }

    if (item.kind !== 'entity') return;

    const newSplit =
      metadata?.newSplit === true || metadata?.event?.shiftKey === true;
    props.onOpen(item.entity, {
      newSplit,
      replacePair: false,
    });
  }

  const list = createListController<InboxListRow, ActivationMetadata>({
    items: rows,
    getKey: (row) => row.id,
    selection: {
      getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
    },
    initialFocusKey: props.state.listFocusKey(),
    initialSelectedKeys: props.state.listSelectedKeys(),
    onFocusChange: ({ requestedKey }) =>
      props.state.setListFocusKey(requestedKey),
    onSelectionChange: (keys) => props.state.setListSelectedKeys([...keys]),
    isNavigable: (row) => row.kind === 'entity',
    isSelectable: (row) => row.kind === 'entity',
    onActivate: activate,
  });

  const listInteractions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    scrollHandle: virtualizer,
    enabled: panel.isPanelActive,
    navigation: {
      onNavigate: (event) => {
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (props.source.loadingMore() || !props.source.hasNextPage()) return;

        const distanceFromEnd = event.result
          ? list.items.count() - event.result.index - 1
          : 0;
        if (distanceFromEnd > 3) return;

        void props.source.loadMore();
      },
    },
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open in new split',
    },
  });
  // TODO: Attach shared entity-action hotkeys once their list aftermath
  // (selection clearing, adjacent focus, and undo restoration) is Soup-agnostic.

  createEffect(() => {
    rows();
    if (props.source.loading()) return;

    const focusKey = props.state.listFocusKey();
    if (list.focus.requestedKey() !== focusKey) {
      list.focus.restore(focusKey, { retainUnavailable: false });
    }
    if (list.focus.result()) return;

    const restored = list.focus.restore(focusKey, {
      retainUnavailable: false,
    });
    if (restored) return;

    list.focus.first({
      isNavigable: (row) => row.kind === 'entity',
      reason: 'restore',
    });
  });

  function checkNearEnd() {
    const handle = virtualizer();
    if (!handle || !props.source.hasNextPage()) return;

    const distance =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    if (distance < 300 && !props.source.loadingMore()) {
      void props.source.loadMore();
    }
  }

  return (
    <div
      role="grid"
      aria-label="Inbox"
      aria-multiselectable="true"
      aria-activedescendant={list.focus.key()}
      tabIndex={0}
      class="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ink/2 outline-none"
    >
      <Show when={isTouchDevice()}>
        <PullToRefresh
          scrollContainer={viewport}
          onRefresh={props.source.refresh}
        />
      </Show>
      <Show
        when={!props.source.loading()}
        fallback={
          <div class="grid min-h-0 flex-1 place-items-center text-ink-muted">
            <SpinnerIcon
              aria-label="Loading inbox"
              class="size-5 animate-spin"
            />
          </div>
        }
      >
        <Show
          when={!props.source.error()}
          fallback={
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
              <span>Inbox couldn’t be loaded.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void props.source.refresh()}
              >
                Try again
              </Button>
            </div>
          }
        >
          <Show
            when={rows().length > 0}
            fallback={<InboxEmptyState state={props.state} />}
          >
            <div
              ref={setViewport}
              class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-none pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            >
              <Virtualizer
                ref={setVirtualizer}
                data={rows()}
                scrollRef={viewport()}
                bufferSize={500}
                itemSize={88}
                keepMounted={
                  list.focus.index() >= 0 ? [list.focus.index()] : undefined
                }
                onScroll={checkNearEnd}
              >
                {(row) => (
                  <Switch>
                    <Match when={row.kind === 'entity' ? row : undefined}>
                      {(entityRow) => (
                        <div
                          id={entityRow().id}
                          role="row"
                          class="group/inbox-item soup-list-entity border-ink/[0.05] border-b"
                        >
                          <div role="gridcell">
                            <InboxCardLayout
                              class="rounded-none! px-4! py-3!"
                              item={displayItem(entityRow().entity)}
                              selected={list.selection.isSelected(
                                entityRow().id
                              )}
                              highlighted={list.focus.key() === entityRow().id}
                              focusable={false}
                              onClick={(event) => {
                                if (event.metaKey || event.ctrlKey) {
                                  listInteractions.selection.toggle(
                                    entityRow().id
                                  );
                                  return;
                                }

                                list.activate.key(entityRow().id, {
                                  reason: 'pointer',
                                  metadata: { event },
                                });
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </Match>
                    <Match when={row.kind === 'load-more' ? row : undefined}>
                      {(loadMore) => (
                        <div id={loadMore().id} role="row">
                          <div
                            role="gridcell"
                            aria-busy={loadMore().isLoading}
                            class={cn(
                              'flex min-h-12 items-center justify-center',
                              list.focus.key() === loadMore().id &&
                                'bg-active/60'
                            )}
                            onClick={() =>
                              list.activate.key(loadMore().id, {
                                reason: 'pointer',
                              })
                            }
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              depth={2}
                              disabled={loadMore().isLoading}
                              class="bg-surface"
                            >
                              <Show
                                when={!loadMore().isLoading}
                                fallback={
                                  <SpinnerIcon class="size-3 animate-spin" />
                                }
                              >
                                <CaretDownIcon class="size-2.5" />
                              </Show>
                              {loadMore().isLoading
                                ? 'Loading...'
                                : 'Load More'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </Match>
                  </Switch>
                )}
              </Virtualizer>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
