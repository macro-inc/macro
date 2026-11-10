import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Card, Tabs } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { DismissedIdea, IdeaCard } from '../components/idea-card';
import type { IdeaActions } from '../context/ideas-source';
import type { FeedFilter } from '../core/idea';
import type { IdeasFeed } from '../primitives/feed';

function FeedSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('ideas.loading')}
      class="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <Card variant="filled" depth={3} class="gap-3 p-4">
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="w-4/5" />
            <ListSkeleton.Bar class="w-3/5" />
          </Card>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** The For you page: every idea as a card, filtered by where it stands. */
export function ForYouView(props: {
  feed: IdeasFeed;
  actions: Pick<IdeaActions, 'routineText'>;
  focusedId?: string;
  onRetry(): void;
}) {
  const options = (): {
    value: FeedFilter;
    label: string;
    count?: number;
  }[] => {
    const counts = props.feed.counts();

    return [
      { value: 'all', label: t('ideas.all') },
      {
        value: 'running',
        label: t('ideas.running'),
        count: counts.running || undefined,
      },
      {
        value: 'open',
        label: t('ideas.open'),
        count: counts.open || undefined,
      },
      { value: 'done', label: t('ideas.done') },
    ];
  };

  return (
    <section
      class="min-h-0 flex-1 overflow-y-auto px-8"
      aria-label={t('nav.forYou')}
    >
      <div class="mx-auto w-full max-w-200 pt-12 pb-16">
        <h1 class="text-3xl font-medium tracking-tight">{t('nav.forYou')}</h1>
        <p class="mt-3 text-sm text-ink-muted">{t('ideas.subtitle')}</p>
        <div class="mt-8 border-b border-edge-muted pb-4">
          <Tabs
            aria-label={t('ideas.filters')}
            size="sm"
            value={props.feed.filter()}
            onChange={props.feed.setFilter}
            options={options()}
          />
        </div>
        <div class="mt-4">
          <Switch>
            <Match when={props.feed.view().kind === 'loading'}>
              <FeedSkeleton />
            </Match>
            <Match when={props.feed.view().kind === 'error'}>
              <div
                role="alert"
                class="flex items-center justify-between gap-4 py-5 text-sm text-ink-muted"
              >
                <span>{t('ideas.loadError')}</span>
                <Button variant="ghost" size="sm" onClick={props.onRetry}>
                  {t('ideas.retry')}
                </Button>
              </div>
            </Match>
            <Match when={props.feed.view().kind === 'empty'}>
              <div class="flex flex-col items-center py-24 text-center">
                <span class="flex size-11 items-center justify-center rounded-xl bg-ink/5">
                  <CheckIcon class="size-5 text-success" />
                </span>
                <Show
                  when={props.feed.filter() === 'all'}
                  fallback={
                    <p class="mt-4 text-sm text-ink-muted">
                      {t('ideas.emptyFilter')}
                    </p>
                  }
                >
                  <h2 class="mt-4 text-lg font-medium">
                    {t('ideas.emptyTitle')}
                  </h2>
                  <p class="mt-2 max-w-md text-sm text-ink-muted">
                    {t('ideas.emptyBody')}
                  </p>
                </Show>
              </div>
            </Match>
            <Match
              when={(() => {
                const view = props.feed.view();
                return view.kind === 'ideas' && view.entries;
              })()}
            >
              {(entries) => (
                <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3 p-0">
                  <For each={entries()}>
                    {(entry) => (
                      <li
                        class="min-w-0 scroll-mt-4"
                        ref={(element) => {
                          if (entry.idea.id !== props.focusedId) return;

                          onElementConnect(element, () =>
                            element.scrollIntoView({ block: 'start' })
                          );
                        }}
                      >
                        <Show
                          when={!entry.dismissed}
                          fallback={
                            <DismissedIdea
                              idea={entry.idea}
                              onUndo={() => props.feed.undoDismiss(entry.idea)}
                            />
                          }
                        >
                          <IdeaCard
                            idea={entry.idea}
                            status={entry.status}
                            busy={entry.busy}
                            failed={entry.failed}
                            routine={
                              entry.idea.kind === 'routine'
                                ? props.actions.routineText(
                                    entry.idea.routineSuggestionId
                                  )
                                : undefined
                            }
                            onAccept={() => props.feed.accept(entry.idea)}
                            onOpen={() => props.feed.open(entry.idea)}
                            onReview={() =>
                              props.feed.reviewRoutine(entry.idea)
                            }
                            onDismiss={() => props.feed.dismiss(entry.idea)}
                          />
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  );
}
