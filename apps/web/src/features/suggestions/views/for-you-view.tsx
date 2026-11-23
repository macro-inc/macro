import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { formatLocale, t } from '@app/lib/i18n';
import { onElementConnect } from '@core/util/onElementConnect';
import CheckCircleIcon from '@icon/system/fill/check-circle-fill.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Card, cn, Item } from '@ui';
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
  DoneRow,
  MacroRow,
  ToDoRow,
} from '../components/suggestion-row';
import type { SuggestionItemParts } from '../context/suggestions-source';
import { doneWhenTakenUp } from '../core/suggestion';
import type { FeedEntry, SuggestionsFeed } from '../primitives/feed';
import type { Refresh } from '../primitives/refresh';

/** One of the page's lists, as a card under its name. */
function ListCard(props: {
  label: string;
  /** A last line under the rows, such as what the list folds away. */
  footer?: JSX.Element;
  children: JSX.Element;
}) {
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
      {props.footer}
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

type ListName = 'macro' | 'toDo' | 'running' | 'done';

/**
 * Which list an entry is in: where it stands first (done, then running or
 * failed), else whose it is, since an item of the person's own waits on them
 * and everything else is work Macro can do.
 */
function listOf(entry: FeedEntry): ListName {
  if (entry.status === 'done') return 'done';
  if (entry.status === 'running' || entry.status === 'failed') {
    return 'running';
  }

  return entry.suggestion.kind === 'entity' ? 'toDo' : 'macro';
}

/**
 * The For you page: four lists. Suggestions is work Macro can do, started by
 * each row's button; To do is the person's own mail and documents that wait
 * on them; Running is what was started, failed runs included; Done today is
 * what finished.
 */
export function ForYouView(props: {
  feed: SuggestionsFeed;
  parts: SuggestionItemParts;
  focusedId?: string;
  /** Rating one suggestion, for the production page; fixtures leave it out. */
  feedback?: (suggestionId: string) => JSX.Element;
  onRetry(): void;
}) {
  const entries = () => {
    const view = props.feed.view();
    return view.kind === 'suggestions' ? view.entries : [];
  };
  // A dismissed entry stays in the list it was in, to undo.
  const inList = (name: ListName) =>
    entries().filter((entry) => listOf(entry) === name);
  const macro = () => inList('macro');
  const toDo = () => inList('toDo');
  const running = () => inList('running');
  const done = () => inList('done').filter((entry) => !entry.dismissed);
  // Nothing waits on the person, is offered, or runs.
  const clear = () =>
    props.feed.view().kind === 'empty' ||
    (props.feed.view().kind === 'suggestions' &&
      ![...macro(), ...toDo(), ...running()].some((entry) => !entry.dismissed));
  // While something still waits, only the latest finished one is in view;
  // the earlier ones fold away, unless one of them was asked for.
  const [earlierOpen, setEarlierOpen] = createSignal(false);
  const earlier = () => (clear() ? [] : done().slice(1));
  const folded = () =>
    earlier().length > 0 &&
    !earlierOpen() &&
    !earlier().some((entry) => entry.suggestion.id === props.focusedId);
  const doneShown = () => (folded() ? done().slice(0, 1) : done());
  const byId = (entry: FeedEntry) => entry.suggestion.id;
  // Read where it renders, so it follows the interface language.
  const today = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date());

  // Rows are kept by suggestion id, so a feed read or a busy flag updates a
  // row in place: focus stays, and the scroll to the one asked for runs once.
  const row = (entry: Accessor<FeedEntry>) => {
    // Keyed by id, so the row's thumbs stay one control across feed reads.
    const feedback = () => props.feedback?.(untrack(entry).suggestion.id);
    return (
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
          <Match when={entry().status === 'done'}>
            <DoneRow
              suggestion={entry().suggestion}
              feedback={feedback()}
              onOpen={() => props.feed.open(entry().suggestion)}
            />
          </Match>
          <Match when={entry().suggestion.kind === 'entity'}>
            <ToDoRow
              suggestion={entry().suggestion}
              status={entry().status}
              busy={entry().busy}
              failed={entry().failed}
              changed={entry().changed}
              feedback={feedback()}
              parts={props.parts}
              onOpen={() => props.feed.accept(entry().suggestion)}
              onMarkDone={
                doneWhenTakenUp(entry().suggestion)
                  ? () => props.feed.markDone(entry().suggestion)
                  : undefined
              }
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
              feedback={feedback()}
              onAccept={() => props.feed.accept(entry().suggestion)}
              onLook={() => props.feed.look(entry().suggestion)}
              onDismiss={() => props.feed.dismiss(entry().suggestion)}
            />
          </Match>
        </Switch>
      </li>
    );
  };

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
          <p class="text-base text-ink-muted">{today()}</p>
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
            <Show when={running().length > 0}>
              <ListCard label={t('suggestions.running')}>
                <Key each={running()} by={byId}>
                  {row}
                </Key>
              </ListCard>
            </Show>
            <Show when={done().length > 0}>
              <ListCard
                label={t('suggestions.doneToday')}
                footer={
                  <Show when={earlier().length > 0}>
                    <Card.Footer class="p-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        class="w-full justify-between text-ink-extra-muted"
                        aria-expanded={!folded()}
                        data-suggestions-earlier
                        onClick={() => setEarlierOpen((open) => !open)}
                      >
                        {t('suggestions.earlierToday', {
                          count: earlier().length,
                        })}
                        <CaretDownIcon
                          class={cn(
                            'size-3.5 transition-transform',
                            !folded() && 'rotate-180'
                          )}
                        />
                      </Button>
                    </Card.Footer>
                  </Show>
                }
              >
                <Key each={doneShown()} by={byId}>
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
