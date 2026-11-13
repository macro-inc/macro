import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Card, Tabs } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { RefreshSuggestions } from '../components/refresh-suggestions';
import {
  DismissedSuggestion,
  DoneSuggestionRow,
  SuggestionCard,
} from '../components/suggestion-card';
import type {
  SuggestionActions,
  SuggestionItemParts,
} from '../context/suggestions-source';
import type { FeedFilter } from '../core/suggestion';
import type { FeedEntry, SuggestionsFeed } from '../primitives/feed';
import type { Refresh } from '../primitives/refresh';

function SectionLabel(props: { children: JSX.Element }) {
  return (
    <h2 class="mt-3 flex items-center gap-3 px-0.5 text-[13px] font-normal text-ink-muted after:h-px after:flex-1 after:bg-edge-muted after:content-['']">
      {props.children}
    </h2>
  );
}

function FeedSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('suggestions.loading')}
      class="flex flex-col gap-3"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <Card variant="filled" depth={3} class="gap-3 p-3">
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="w-4/5" />
            <ListSkeleton.Bar class="w-3/5" />
          </Card>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** The For you page: every suggestion as a card, filtered by where it stands. */
export function ForYouView(props: {
  feed: SuggestionsFeed;
  actions: Pick<SuggestionActions, 'routineText' | 'openItem'>;
  parts: SuggestionItemParts;
  refresh: Refresh;
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
      { value: 'all', label: t('suggestions.all') },
      {
        value: 'running',
        label: t('suggestions.running'),
        count: counts.running || undefined,
      },
      {
        value: 'open',
        label: t('suggestions.open'),
        count: counts.open || undefined,
      },
      { value: 'done', label: t('suggestions.done') },
    ];
  };

  /** The feed in three parts: what waits or runs, what is done, what was dismissed here. */
  const sections = () => {
    const view = props.feed.view();
    if (view.kind !== 'suggestions') return undefined;

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
        if (entry.suggestion.id !== props.focusedId) return;

        onElementConnect(element, () =>
          element.scrollIntoView({ block: 'start' })
        );
      }}
    >
      <Show
        when={entry.status !== 'done'}
        fallback={
          <DoneSuggestionRow
            suggestion={entry.suggestion}
            onOpen={() => props.feed.open(entry.suggestion)}
          />
        }
      >
        <SuggestionCard
          suggestion={entry.suggestion}
          status={entry.status}
          isNew={entry.isNew}
          busy={entry.busy}
          failed={entry.failed}
          changed={entry.changed}
          parts={props.parts}
          routine={
            entry.suggestion.kind === 'routine'
              ? props.actions.routineText(entry.suggestion.routineSuggestionId)
              : undefined
          }
          onAccept={() => props.feed.accept(entry.suggestion)}
          onOpen={() => props.feed.open(entry.suggestion)}
          onOpenInChat={() => props.feed.openInChat(entry.suggestion)}
          onOpenSource={props.actions.openItem}
          onReview={() => props.feed.reviewRoutine(entry.suggestion)}
          onDismiss={() => props.feed.dismiss(entry.suggestion)}
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
        <div class="flex items-center justify-between gap-4">
          <h1 class="text-3xl font-medium tracking-tight">{t('nav.forYou')}</h1>
          <Show when={props.refresh.state()} keyed>
            {(state) => (
              <RefreshSuggestions
                state={state}
                failed={props.refresh.failed()}
                onRefresh={props.refresh.refresh}
              />
            )}
          </Show>
        </div>
        <p class="mt-3 text-sm text-ink-muted">{t('suggestions.subtitle')}</p>
        <div class="mt-8 border-b border-edge-muted pb-4">
          <Tabs
            aria-label={t('suggestions.filters')}
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
                <span>{t('suggestions.loadError')}</span>
                <Button variant="ghost" size="sm" onClick={props.onRetry}>
                  {t('suggestions.retry')}
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
                      {t('suggestions.emptyFilter')}
                    </p>
                  }
                >
                  <h2 class="mt-4 text-lg font-medium">
                    {t('suggestions.emptyTitle')}
                  </h2>
                  <p class="mt-2 max-w-md text-sm text-ink-muted">
                    {t('suggestions.emptyBody')}
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
                    <SectionLabel>{t('suggestions.doneToday')}</SectionLabel>
                    <ul class="m-0 flex list-none flex-col gap-3 p-0">
                      <For each={shown.done}>{(entry) => card(entry)}</For>
                    </ul>
                  </Show>
                  <Show when={shown.dismissed.length > 0}>
                    <SectionLabel>
                      {t('suggestions.dismissedSection')}
                    </SectionLabel>
                    <ul class="m-0 flex list-none flex-col gap-3 p-0">
                      <For each={shown.dismissed}>
                        {(entry) => (
                          <li>
                            <DismissedSuggestion
                              suggestion={entry.suggestion}
                              wasRunning={entry.status === 'running'}
                              busy={entry.busy}
                              failed={entry.failed}
                              onUndo={() =>
                                props.feed.undoDismiss(entry.suggestion)
                              }
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
