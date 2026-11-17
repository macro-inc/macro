import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { formatLocale, t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Card, Item } from '@ui';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { RefreshSuggestions } from '../components/refresh-suggestions';
import {
  DismissedSuggestion,
  DoneSuggestionRow,
  SuggestionRow,
} from '../components/suggestion-row';
import type {
  SuggestionActions,
  SuggestionItemParts,
} from '../context/suggestions-source';
import type { SectionCounts } from '../core/suggestion';
import type { FeedEntry, SuggestionsFeed } from '../primitives/feed';
import type { Refresh } from '../primitives/refresh';

/** One of the page's lists, under its name and how many it holds. */
function Section(props: {
  label: string;
  count?: number;
  children: JSX.Element;
}) {
  const headingId = createUniqueId();

  return (
    <section class="flex flex-col" aria-labelledby={headingId}>
      <h2
        id={headingId}
        class="flex h-8 items-center gap-2 px-3 text-sm font-medium text-ink"
      >
        {props.label}
        <Show when={props.count}>
          <span class="font-normal text-ink-extra-muted">{props.count}</span>
        </Show>
      </h2>
      <ul class="m-0 flex list-none flex-col p-0">{props.children}</ul>
    </section>
  );
}

/**
 * A row's place in its list, under a hairline that starts at the titles. A
 * row that is opened or pointed at is filled, so neither it nor the row
 * after it draws the line. A new suggestion gets a dot at the list's edge.
 */
function Row(props: {
  ref?: (element: HTMLLIElement) => void;
  isNew?: boolean;
  children: JSX.Element;
}) {
  return (
    <li
      ref={props.ref}
      class="relative scroll-mt-4 not-first:before:absolute not-first:before:top-0 not-first:before:right-3 not-first:before:left-12 not-first:before:h-px not-first:before:bg-edge not-first:before:content-[''] has-[[data-variant=filled]]:before:hidden not-touch:hover:before:hidden [li:has([data-variant=filled])+&]:before:hidden not-touch:[li:hover+&]:before:hidden"
    >
      <Show when={props.isNew}>
        <span
          class="absolute top-5.5 left-0 size-1.5 rounded-full bg-accent"
          role="img"
          aria-label={t('suggestions.newSuggestion')}
        />
      </Show>
      {props.children}
    </li>
  );
}

function FeedSkeleton() {
  return (
    <ListSkeleton.Root label={t('suggestions.loading')} class="flex flex-col">
      <For each={[0, 1, 2, 3]}>
        {() => (
          <div class="flex flex-col gap-3 p-3 pl-12">
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="w-3/5" />
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** How much of what the feed shows is done, in words and as a bar. */
function Progress(props: { counts: SectionCounts }) {
  const all = () =>
    props.counts.open + props.counts.running + props.counts.done;

  return (
    <Show when={all() > 0}>
      <div class="flex h-5 shrink-0 items-center gap-3 text-sm text-ink-muted">
        <span data-suggestions-progress>
          {t('suggestions.doneOfAll', {
            done: props.counts.done,
            count: all(),
          })}
        </span>
        <span class="h-1 w-20 rounded-full bg-edge" aria-hidden="true">
          <span
            class="block h-1 rounded-full bg-ink-muted"
            style={{ width: `${(props.counts.done / all()) * 100}%` }}
          />
        </span>
      </div>
    </Show>
  );
}

/** The page's Refresh control, for the bar above it. */
export function ForYouRefresh(props: { refresh: Refresh }) {
  return (
    <Show when={props.refresh.state()} keyed>
      {(state) => (
        <RefreshSuggestions
          state={state}
          failed={props.refresh.failed()}
          onRefresh={props.refresh.refresh}
        />
      )}
    </Show>
  );
}

/**
 * The For you page: the day's suggestions as one list, by where each one
 * stands: what waits for the person, what is running, what is done.
 */
export function ForYouView(props: {
  feed: SuggestionsFeed;
  actions: Pick<SuggestionActions, 'openItem'>;
  parts: SuggestionItemParts;
  focusedId?: string;
  onRetry(): void;
}) {
  // The row whose details are open: the one opened from Home, to begin with.
  const [openId, setOpenId] = createSignal(untrack(() => props.focusedId));
  const toggle = (id: string) =>
    setOpenId((open) => (open === id ? undefined : id));
  const [logbookOpen, setLogbookOpen] = createSignal(false);

  const entries = () => {
    const view = props.feed.view();
    return view.kind === 'suggestions' ? view.entries : [];
  };
  const shown = () => entries().filter((entry) => !entry.dismissed);
  const open = () => shown().filter((entry) => entry.status === 'open');
  // A failed run sits with the running ones: it is neither waiting nor done.
  const running = () =>
    shown().filter(
      (entry) => entry.status === 'running' || entry.status === 'failed'
    );
  const done = () => shown().filter((entry) => entry.status === 'done');
  const dismissed = () => entries().filter((entry) => entry.dismissed);
  const clear = () => open().length + running().length === 0;
  // While something still waits, only the latest finished one is in view;
  // the earlier ones fold into the Logbook, unless one of them was asked for.
  const earlier = () => (clear() ? [] : done().slice(1));
  const folded = () =>
    earlier().length > 0 &&
    !logbookOpen() &&
    !earlier().some((entry) => entry.suggestion.id === props.focusedId);
  const latest = () => (clear() ? done() : done().slice(0, 1));
  const byId = (entry: FeedEntry) => entry.suggestion.id;
  const waiting = () => props.feed.counts().open + props.feed.counts().running;
  const today = new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  // Rows are kept by suggestion id, so a feed read or a busy flag updates a
  // row in place: focus stays, and the scroll to the opened one runs once.
  const row = (entry: Accessor<FeedEntry>) => (
    <Row
      isNew={entry().isNew && entry().status !== 'done'}
      ref={(element) => {
        if (untrack(entry).suggestion.id !== props.focusedId) return;

        onElementConnect(element, () =>
          element.scrollIntoView({ block: 'start' })
        );
      }}
    >
      <Show
        when={entry().status !== 'done'}
        fallback={
          <DoneSuggestionRow
            suggestion={entry().suggestion}
            quiet={
              clear() || done()[0]?.suggestion.id !== entry().suggestion.id
            }
            onOpen={() => props.feed.open(entry().suggestion)}
          />
        }
      >
        <SuggestionRow
          suggestion={entry().suggestion}
          status={entry().status}
          busy={entry().busy}
          failed={entry().failed}
          changed={entry().changed}
          expanded={openId() === entry().suggestion.id}
          parts={props.parts}
          onToggle={() => toggle(entry().suggestion.id)}
          onAccept={() => props.feed.accept(entry().suggestion)}
          onMarkDone={() => props.feed.markDone(entry().suggestion)}
          onOpen={() => props.feed.open(entry().suggestion)}
          onOpenInChat={() => props.feed.openInChat(entry().suggestion)}
          onOpenSource={props.actions.openItem}
          onReview={() => props.feed.reviewRoutine(entry().suggestion)}
          onDismiss={() => props.feed.dismiss(entry().suggestion)}
        />
      </Show>
    </Row>
  );

  return (
    <section
      class="min-h-0 flex-1 overflow-y-auto px-8"
      aria-label={t('nav.forYou')}
    >
      <div class="mx-auto flex w-full max-w-200 flex-col gap-6 pt-10 pb-16">
        <header class="flex items-end justify-between gap-4 px-3 pb-1">
          <div class="flex min-w-0 flex-col gap-1">
            <h1 class="text-3xl font-semibold tracking-tight">
              {t('suggestions.today')}
            </h1>
            <p class="text-sm text-ink-muted">
              {today}
              {waiting() > 0
                ? ` · ${t('suggestions.thingsWaiting', { count: waiting() })}`
                : ''}
            </p>
          </div>
          <Progress counts={props.feed.counts()} />
        </header>
        <Switch>
          <Match when={props.feed.view().kind === 'loading'}>
            <FeedSkeleton />
          </Match>
          <Match when={props.feed.view().kind === 'error'}>
            <div
              role="alert"
              class="flex items-center justify-between gap-4 px-3 py-5 text-sm text-ink-muted"
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
              <h2 class="mt-4 text-lg font-medium">
                {t('suggestions.emptyTitle')}
              </h2>
              <p class="mt-2 max-w-md text-sm text-ink-muted">
                {t('suggestions.emptyBody')}
              </p>
            </div>
          </Match>
          <Match when={props.feed.view().kind === 'suggestions'}>
            {/* Nothing waits or runs, but the day's work is still listed below. */}
            <Show when={clear()}>
              <Card variant="filled" depth={3} data-suggestions-clear>
                <Card.Header class="p-4">
                  <Item class="items-center gap-3.5 p-0">
                    <Item.Media class="size-9 self-center rounded-full bg-success-bg">
                      <CheckIcon class="size-4 text-success" />
                    </Item.Media>
                    <Item.Content class="gap-0">
                      <Card.Title
                        role="heading"
                        aria-level={2}
                        class="text-base leading-6 font-medium"
                      >
                        {t('suggestions.emptyTitle')}
                      </Card.Title>
                      <Card.Description>
                        {t('suggestions.emptyBody')}
                      </Card.Description>
                    </Item.Content>
                  </Item>
                </Card.Header>
              </Card>
            </Show>
            <Show when={open().length > 0}>
              <Section
                label={t('suggestions.toDo')}
                count={props.feed.counts().open}
              >
                <Key each={open()} by={byId}>
                  {row}
                </Key>
              </Section>
            </Show>
            <Show when={running().length > 0}>
              <Section
                label={t('suggestions.running')}
                count={props.feed.counts().running}
              >
                <Key each={running()} by={byId}>
                  {row}
                </Key>
              </Section>
            </Show>
            <Show when={done().length > 0}>
              <Section
                label={t('suggestions.doneToday')}
                count={props.feed.counts().done}
              >
                <Key each={latest()} by={byId}>
                  {row}
                </Key>
                <Show when={earlier().length > 0}>
                  <Row>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm outline-none not-touch:hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                      aria-expanded={!folded()}
                      data-suggestions-logbook
                      onClick={() => setLogbookOpen((open) => !open)}
                    >
                      <span class="flex size-6 shrink-0 items-center justify-center text-ink-muted">
                        <TrayIcon class="size-4" />
                      </span>
                      <span class="font-medium text-ink-muted">
                        {t('suggestions.logbook')}
                      </span>
                      <span class="text-ink-extra-muted">
                        {t('suggestions.earlierToday', {
                          count: earlier().length,
                        })}
                      </span>
                      <span class="ml-auto text-ink-extra-muted">
                        <Show
                          when={folded()}
                          fallback={<CaretDownIcon class="size-3.5" />}
                        >
                          <CaretRightIcon class="size-3.5" />
                        </Show>
                      </span>
                    </button>
                  </Row>
                </Show>
                <Show when={!folded()}>
                  <Key each={earlier()} by={byId}>
                    {row}
                  </Key>
                </Show>
              </Section>
            </Show>
            <Show when={dismissed().length > 0}>
              <Section label={t('suggestions.dismissedSection')}>
                <Key each={dismissed()} by={byId}>
                  {(entry) => (
                    <Row>
                      <DismissedSuggestion
                        suggestion={entry().suggestion}
                        wasRunning={entry().status === 'running'}
                        busy={entry().busy}
                        failed={entry().failed}
                        onUndo={() =>
                          props.feed.undoDismiss(entry().suggestion)
                        }
                      />
                    </Row>
                  )}
                </Key>
              </Section>
            </Show>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
