import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { formatLocale, t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckCircleIcon from '@icon/system/fill/check-circle-fill.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Card, Item } from '@ui';
import {
  type Accessor,
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
  MacroRow,
  ToDoRow,
} from '../components/suggestion-row';
import type { SuggestionItemParts } from '../context/suggestions-source';
import type { FeedEntry, SuggestionsFeed } from '../primitives/feed';
import type { Refresh } from '../primitives/refresh';

/** One of the page's two lists, as a card under its name. */
function ListCard(props: { label: string; children: JSX.Element }) {
  const headingId = createUniqueId();

  return (
    <Card variant="filled" depth={3} role="region" aria-labelledby={headingId}>
      <Card.Header class="px-3 pt-3 pb-1.5">
        <Card.Title id={headingId} role="heading" aria-level={2}>
          {props.label}
        </Card.Title>
      </Card.Header>
      <Card.Body class="p-1 pt-0">
        <ul class="m-0 flex list-none flex-col p-0">{props.children}</ul>
      </Card.Body>
    </Card>
  );
}

function FeedSkeleton() {
  return (
    <Card variant="filled" depth={3}>
      <Card.Body>
        <ListSkeleton.Root
          label={t('suggestions.loading')}
          class="flex flex-col"
        >
          <For each={[0, 1, 2, 3]}>
            {() => (
              <div class="flex flex-col gap-2.5 py-2 pl-7">
                <ListSkeleton.Bar class="h-3 w-2/5" />
                <ListSkeleton.Bar class="w-3/5" />
              </div>
            )}
          </For>
        </ListSkeleton.Root>
      </Card.Body>
    </Card>
  );
}

/** Nothing waits on the person and Macro has nothing to offer. */
function ClearCard() {
  return (
    <Card variant="filled" depth={3} data-suggestions-clear>
      <Card.Header>
        <Item class="items-start p-0">
          <Item.Icon class="text-success" aria-hidden="true">
            <CheckCircleIcon />
          </Item.Icon>
          <Item.Content>
            <Card.Title role="heading" aria-level={2}>
              {t('suggestions.emptyTitle')}
            </Card.Title>
            <Card.Description>{t('suggestions.emptyBody')}</Card.Description>
          </Item.Content>
        </Item>
      </Card.Header>
    </Card>
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
 * The For you page: two lists. Suggestions is work Macro can do, started by
 * each row's button; To do is the person's own mail and documents that wait
 * on them. What is finished leaves the page.
 */
export function ForYouView(props: {
  feed: SuggestionsFeed;
  parts: SuggestionItemParts;
  focusedId?: string;
  onRetry(): void;
}) {
  const entries = () => {
    const view = props.feed.view();
    return view.kind === 'suggestions' ? view.entries : [];
  };
  // Finished ones are not listed; a dismissed one stays in its list to undo.
  const listed = () =>
    entries().filter((entry) => entry.dismissed || entry.status !== 'done');
  // An item of the person's own waits on them; everything else is Macro's.
  const toDo = () =>
    listed().filter((entry) => entry.suggestion.kind === 'entity');
  const macro = () =>
    listed().filter((entry) => entry.suggestion.kind !== 'entity');
  const clear = () =>
    props.feed.view().kind === 'empty' ||
    (props.feed.view().kind === 'suggestions' &&
      !listed().some((entry) => !entry.dismissed));
  const byId = (entry: FeedEntry) => entry.suggestion.id;
  const today = new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  // Rows are kept by suggestion id, so a feed read or a busy flag updates a
  // row in place: focus stays, and the scroll to the one asked for runs once.
  const row = (entry: Accessor<FeedEntry>) => (
    <li
      class="scroll-mt-4"
      ref={(element) => {
        if (untrack(entry).suggestion.id !== props.focusedId) return;

        onElementConnect(element, () =>
          element.scrollIntoView({ block: 'start' })
        );
      }}
    >
      <Switch>
        <Match when={entry().dismissed}>
          <DismissedSuggestion
            suggestion={entry().suggestion}
            wasRunning={entry().status === 'running'}
            busy={entry().busy}
            failed={entry().failed}
            onUndo={() => props.feed.undoDismiss(entry().suggestion)}
          />
        </Match>
        <Match when={entry().suggestion.kind === 'entity'}>
          <ToDoRow
            suggestion={entry().suggestion}
            status={entry().status}
            busy={entry().busy}
            failed={entry().failed}
            changed={entry().changed}
            parts={props.parts}
            onOpen={() => props.feed.accept(entry().suggestion)}
            onMarkDone={() => props.feed.markDone(entry().suggestion)}
            onDismiss={() => props.feed.dismiss(entry().suggestion)}
          />
        </Match>
        <Match when={entry().suggestion.kind !== 'entity'}>
          <MacroRow
            suggestion={entry().suggestion}
            status={entry().status}
            busy={entry().busy}
            failed={entry().failed}
            changed={entry().changed}
            onAccept={() => props.feed.accept(entry().suggestion)}
            onLook={() => props.feed.look(entry().suggestion)}
            onDismiss={() => props.feed.dismiss(entry().suggestion)}
          />
        </Match>
      </Switch>
    </li>
  );

  return (
    <section
      class="min-h-0 flex-1 overflow-y-auto px-8"
      aria-label={t('nav.forYou')}
    >
      <div class="mx-auto flex w-full max-w-180 flex-col gap-4 pt-9 pb-16">
        <header class="flex flex-col gap-0.5 px-4 pb-2">
          <h1 class="text-[34px] leading-10 font-bold tracking-tight">
            {t('suggestions.today')}
          </h1>
          <p class="text-base text-ink-muted">{today}</p>
        </header>
        <Switch>
          <Match when={props.feed.view().kind === 'loading'}>
            <FeedSkeleton />
          </Match>
          <Match when={props.feed.view().kind === 'error'}>
            <div
              role="alert"
              class="flex items-center justify-between gap-4 px-4 py-5 text-sm text-ink-muted"
            >
              <span>{t('suggestions.loadError')}</span>
              <Button variant="ghost" size="sm" onClick={props.onRetry}>
                {t('suggestions.retry')}
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <Show when={clear()}>
              <ClearCard />
            </Show>
            <Show when={macro().length > 0}>
              <ListCard label={t('suggestions.suggestionsTitle')}>
                <Key each={macro()} by={byId}>
                  {row}
                </Key>
              </ListCard>
            </Show>
            <Show when={toDo().length > 0}>
              <ListCard label={t('suggestions.toDo')}>
                <Key each={toDo()} by={byId}>
                  {row}
                </Key>
              </ListCard>
            </Show>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
