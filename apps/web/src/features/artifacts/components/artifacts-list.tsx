import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import EmptyStateDocGraphic from '@design/empty-state-doc.svg';
import EmptyStateNoAccessGraphic from '@design/empty-state-no-access.svg';
import {
  type DocumentEntity,
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
  type WithNotification,
} from '@entity';
import { Button, EmptyStatePanel } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import type { ArtifactsListView } from '../primitives/artifacts-list';

function ArtifactsSkeleton(props: { label: string; count: number }) {
  return (
    <ListSkeleton.Root
      label={props.label}
      class="@container/artifacts-skeleton w-full shrink-0 overflow-hidden py-1"
    >
      <For each={Array.from({ length: props.count })}>
        {(_, index) => (
          <ListSkeleton.Row class="h-10 gap-2 px-3">
            <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
            <div class="min-w-0 flex-1">
              <div
                style={{ width: `${[10, 8, 12, 9, 11, 7][index() % 6]}rem` }}
                class="max-w-full"
              >
                <ListSkeleton.Bar class="w-full" />
              </div>
            </div>
            <ListSkeleton.Bar class="hidden w-20 shrink-0 @lg/artifacts-skeleton:block" />
            <ListSkeleton.Bar class="h-2 w-10 shrink-0 opacity-60" />
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** The Artifacts list: unified-list rows, newest first, with its states. */
export function ArtifactsList(props: {
  view: ArtifactsListView;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** Placed after the last row; loading more starts when it scrolls into view. */
  sentinelRef: (element: HTMLDivElement) => void;
  onOpen: (
    artifact: WithNotification<DocumentEntity>,
    event: MouseEvent
  ) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const [list, setList] = createSignal<HTMLElement>();
  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col">
      <Switch>
        <Match when={props.view.t === 'loading'}>
          <ArtifactsSkeleton label={t('artifacts.loading')} count={8} />
        </Match>
        <Match when={props.view.t === 'error'}>
          <EmptyStatePanel
            centered
            topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
            graphic={EmptyStateNoAccessGraphic}
            title={t('artifacts.loadFailed')}
            primaryAction={{
              label: t('common.retry'),
              onClick: props.onRetry,
            }}
          />
        </Match>
        <Match when={props.view.t === 'empty'}>
          <EmptyStatePanel
            centered
            topSpacerClass="grow-[0.5] basis-0 mobile:basis-0"
            graphic={EmptyStateDocGraphic}
            title={t('artifacts.emptyTitle')}
            description={t('artifacts.emptyDescription')}
          />
        </Match>
        <Match when={props.view.t === 'ready' && props.view}>
          {(ready) => (
            <div class="min-h-0 flex-1 overflow-auto touch:pb-(--mobile-content-inset-bottom)">
              <ListEntityMetadataQueryProvider>
                <ListLayoutProvider ref={list}>
                  <div
                    ref={setList}
                    role="list"
                    aria-label={t('artifacts.title')}
                  >
                    <For each={ready().artifacts}>
                      {(artifact) => (
                        <div role="listitem">
                          <ListEntity
                            entity={artifact}
                            hideCheckbox
                            timestamp={artifact.updatedAt}
                            onClick={(event) => props.onOpen(artifact, event)}
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </ListLayoutProvider>
              </ListEntityMetadataQueryProvider>
              <Show
                when={!props.loadMoreFailed}
                fallback={
                  <div class="flex items-center justify-center gap-2 p-3 text-xs text-ink-muted">
                    <span>{t('artifacts.loadMoreFailed')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={props.onLoadMore}
                    >
                      {t('common.retry')}
                    </Button>
                  </div>
                }
              >
                <Show when={props.hasMore}>
                  <div ref={props.sentinelRef} class="h-px" />
                </Show>
                <Show when={props.loadingMore}>
                  <ArtifactsSkeleton
                    label={t('artifacts.loadingMore')}
                    count={2}
                  />
                </Show>
              </Show>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
