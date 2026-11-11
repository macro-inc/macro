import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Card, Tabs } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { DismissedIdea, DoneIdeaRow, IdeaCard } from '../components/idea-card';
import type { IdeaActions, IdeaItemParts } from '../context/ideas-source';
import type { FeedFilter, Idea } from '../core/idea';
import type { FeedEntry, IdeasFeed } from '../primitives/feed';

/** A finished run has something to preview; other finished ideas are one line. */
function hasResult(idea: Idea) {
  return idea.kind === 'prompt' && idea.runMode === 'background';
}

function SectionLabel(props: { children: JSX.Element }) {
  return (
    <h2 class="mt-3 flex items-center gap-3 px-0.5 text-[13px] font-normal text-ink-muted after:h-px after:flex-1 after:bg-edge-muted after:content-['']">
      {props.children}
    </h2>
  );
}

function FeedSkeleton() {
  return (
    <ListSkeleton.Root label={t('ideas.loading')} class="flex flex-col gap-3">
      <For each={[0, 1, 2]}>
        {() => (
          <Card variant="filled" depth={1} class="gap-3 p-3.5">
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
  actions: Pick<IdeaActions, 'routineText' | 'openItem'>;
  parts: IdeaItemParts;
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

  /** The feed in three parts: what waits or runs, what is done, what was dismissed here. */
  const sections = () => {
    const view = props.feed.view();
    if (view.kind !== 'ideas') return undefined;

    const kept = view.entries.filter((entry) => !entry.dismissed);

    return {
      open: kept.filter((entry) => entry.status !== 'done'),
      done: kept.filter((entry) => entry.status === 'done'),
      dismissed: view.entries.filter((entry) => entry.dismissed),
    };
  };
  const card = (entry: FeedEntry) => (
    <li
      class="scroll-mt-4"
      ref={(element) => {
        if (entry.idea.id !== props.focusedId) return;

        onElementConnect(element, () =>
          element.scrollIntoView({ block: 'start' })
        );
      }}
    >
      <Show
        when={entry.status !== 'done' || hasResult(entry.idea)}
        fallback={
          <DoneIdeaRow
            idea={entry.idea}
            onOpen={() => props.feed.open(entry.idea)}
          />
        }
      >
        <IdeaCard
          idea={entry.idea}
          status={entry.status}
          isNew={entry.isNew}
          busy={entry.busy}
          failed={entry.failed}
          changed={entry.changed}
          parts={props.parts}
          routine={
            entry.idea.kind === 'routine'
              ? props.actions.routineText(entry.idea.routineSuggestionId)
              : undefined
          }
          onAccept={() => props.feed.accept(entry.idea)}
          onOpen={() => props.feed.open(entry.idea)}
          onOpenInChat={() => props.feed.openInChat(entry.idea)}
          onOpenSource={props.actions.openItem}
          onReview={() => props.feed.reviewRoutine(entry.idea)}
          onDismiss={() => props.feed.dismiss(entry.idea)}
        />
      </Show>
    </li>
  );

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
            <Match when={sections()} keyed>
              {(shown) => (
                <div class="flex flex-col gap-3">
                  <Show when={shown.open.length > 0}>
                    <ul class="m-0 flex list-none flex-col gap-3 p-0">
                      <For each={shown.open}>{(entry) => card(entry)}</For>
                    </ul>
                  </Show>
                  <Show when={shown.done.length > 0}>
                    <SectionLabel>{t('ideas.doneToday')}</SectionLabel>
                    <ul class="m-0 flex list-none flex-col gap-3 p-0">
                      <For each={shown.done}>{(entry) => card(entry)}</For>
                    </ul>
                  </Show>
                  <Show when={shown.dismissed.length > 0}>
                    <SectionLabel>{t('ideas.dismissedSection')}</SectionLabel>
                    <ul class="m-0 flex list-none flex-col gap-3 p-0">
                      <For each={shown.dismissed}>
                        {(entry) => (
                          <li>
                            <DismissedIdea
                              idea={entry.idea}
                              onUndo={() => props.feed.undoDismiss(entry.idea)}
                            />
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  );
}
