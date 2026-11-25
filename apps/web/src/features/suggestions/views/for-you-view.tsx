import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { formatLocale, t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import UndoIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createUniqueId,
  For,
  Match,
  on,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ForYouSidebar, listName } from '../components/for-you-sidebar';
import { RefreshSuggestions } from '../components/refresh-suggestions';
import { SuggestionRow } from '../components/suggestion-row';
import { TopicHeading } from '../components/topic-heading';
import type {
  RoutinesSource,
  SuggestionItemParts,
} from '../context/suggestions-source';
import { type FeedEntry, type ForYouList, savedRoutineId } from '../core/lists';
import type { Suggestion } from '../core/suggestion';
import type { TopicGroup } from '../core/topics';
import type { SuggestionsFeed } from '../primitives/feed';
import type { Refresh } from '../primitives/refresh';

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

function FeedSkeleton() {
  return (
    <ListSkeleton.Root label={t('suggestions.loading')} class="flex flex-col">
      <For each={[0, 1, 2, 3, 4]}>
        {() => (
          <div class="flex h-14 items-center gap-3 px-4">
            <ListSkeleton.Bar class="size-8 rounded-lg" />
            <div class="flex flex-1 flex-col gap-2">
              <ListSkeleton.Bar class="h-3 w-2/5" />
              <ListSkeleton.Bar class="h-2.5 w-3/5" />
            </div>
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** Nothing in Today waits on the person or is offered by Macro. */
function CaughtUp(props: {
  done: number;
  /** Nothing settled here is held below it, so it fills the page. */
  fill: boolean;
  onSeeDone(): void;
  onBrowseRoutines(): void;
}) {
  return (
    <div
      class={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-16 text-center',
        props.fill && 'flex-1 pb-32'
      )}
      data-suggestions-caught-up
    >
      <div class="mb-2 flex size-10 items-center justify-center rounded-xl bg-hover text-ink-muted">
        <CheckIcon class="size-5" />
      </div>
      <h2 class="text-lg leading-6 font-semibold">
        {t('suggestions.caughtUpTitle')}
      </h2>
      <p class="max-w-100 text-sm text-ink-muted">
        {props.done > 0
          ? t('suggestions.caughtUpBody', { count: props.done })
          : t('suggestions.caughtUpBodyNone')}
      </p>
      <div class="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={props.onSeeDone}>
          {t('suggestions.seeDone')}
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onBrowseRoutines}>
          {t('suggestions.browseRoutines')}
        </Button>
      </div>
    </div>
  );
}

/** What an empty list other than Today says. */
function emptyText(list: ForYouList): string {
  return match(list)
    .with('today', () => t('suggestions.caughtUpTitle'))
    .with('toDo', () => t('suggestions.toDoEmpty'))
    .with('suggestions', () => t('suggestions.suggestionsEmpty'))
    .with('done', () => t('suggestions.doneEmpty'))
    .exhaustive();
}

/**
 * The For you page: a sidebar of lists (Today, To do, Suggestions, Done)
 * with their counts, links to the person's routines and the topics of
 * Today's rows, and the chosen list's rows under its name and the date.
 * Today's are grouped by topic; a chosen topic's rows are shown alone, under
 * its name and why it matters now.
 */
export function ForYouView(props: {
  feed: SuggestionsFeed;
  list: ForYouList;
  onSelectList(list: ForYouList): void;
  /** The key of the topic asked for, shown alone in place of the list. */
  topicKey?: string;
  onSelectTopic(key: string): void;
  /** The topic asked for groups nothing (any more): the list is shown. */
  onTopicGone(): void;
  routines: RoutinesSource;
  parts: SuggestionItemParts;
  refresh: Refresh;
  focusedId?: string;
  onRetry(): void;
}) {
  const view = () => props.feed.view(props.list);
  const topic = () =>
    props.feed.topics().find((other) => other.key === props.topicKey);
  const shownTopicKey = createMemo(() => topic()?.key);
  // One that stops grouping rows leaves the list shown, and isn't asked for any
  // more: rows that bring it back later don't take the page over. One never
  // shown stays asked for, since a cached feed may be from before the topic.
  createEffect(
    on(shownTopicKey, (key, before) => {
      const kind = view().kind;
      const known = kind === 'rows' || kind === 'empty';
      if (known && !key && before && props.topicKey === before) {
        props.onTopicGone();
      }
    })
  );
  const groups = () => props.feed.groups(props.list, topic());
  const name = () => {
    const shown = topic();
    if (shown) return shown.name;

    // Which topic was asked for isn't known until the feed is.
    return props.topicKey && view().kind === 'loading'
      ? ''
      : listName(props.list);
  };
  const hueOf = (entry: FeedEntry) => {
    const topics = props.feed.topics();
    if (topics.length === 0) return undefined;

    const key = entry.suggestion.topic?.key;
    return topics.find((other) => other.key === key)?.hue ?? 'none';
  };
  // Nothing in Today waits or runs; what settled here may still be held.
  const caughtUp = () =>
    props.list === 'today' &&
    !topic() &&
    (view().kind === 'empty' || props.feed.counts()?.today === 0);
  // A routine Macro proposed since the last visit waits in Suggestions.
  const newIdea = () => {
    const offered = props.feed.view('suggestions');
    return (
      offered.kind === 'rows' &&
      offered.entries.some(
        (entry) =>
          entry.state === 'open' &&
          entry.isNew &&
          entry.suggestion.kind === 'routine'
      )
    );
  };
  // Read where it renders, so it follows the interface language.
  const today = () =>
    new Intl.DateTimeFormat(formatLocale(), {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date());

  /** The line under the page's name. */
  const underName = () => {
    const shown = topic();
    if (shown) return shown.reason;

    return caughtUp()
      ? t('suggestions.dateNothingNeeded', { date: today() })
      : today();
  };

  const openRoutines = () => props.routines.openRoutines();

  const markDone = async (suggestion: Suggestion) => {
    const done = await props.feed.markDone(suggestion);
    if (!done) return;

    toast.success(t('suggestions.markedDoneToast'), {
      subtext: suggestion.title,
      dismissStyle: 'icon',
      actions: [
        {
          label: t('suggestions.undo'),
          icon: UndoIcon,
          onClick: () =>
            fireAndForget(props.feed.undoDone(suggestion), 'suggestions'),
        },
      ],
    });
  };

  const accept = async (entry: FeedEntry) => {
    const suggestion = entry.suggestion;
    const taken = await props.feed.accept(suggestion);
    if (!taken || suggestion.kind !== 'routine') return;

    toast.success(t('suggestions.routineOnToast'), {
      subtext: t('suggestions.routineAdded'),
      dismissStyle: 'icon',
      actions: [
        {
          label: t('suggestions.viewRoutine'),
          onClick: () => {
            // The row as the feed now has it, with the routine it saved.
            const listed = props.feed.view('today');
            const saved = (listed.kind === 'rows' ? listed.entries : []).find(
              (other) => other.suggestion.id === suggestion.id
            );
            const routineId = saved && savedRoutineId(saved.suggestion);
            props.routines.openRoutines(routineId);
          },
        },
      ],
    });
  };

  const setRoutineEnabled = (entry: FeedEntry, enabled: boolean) => {
    const routineId = savedRoutineId(entry.suggestion);
    if (!routineId) return;

    fireAndForget(
      props.routines.setEnabled(routineId, enabled),
      'suggestions.routine_enabled'
    );
  };

  // Rows are kept by suggestion id, so a feed read or a busy flag updates a
  // row in place: focus stays, and the scroll to the one asked for runs once.
  // A row that changes groups is made anew, and doesn't scroll again.
  let scrolledTo: string | undefined;
  createEffect(() => {
    if (props.focusedId !== scrolledTo) scrolledTo = undefined;
  });
  const row = (entry: Accessor<FeedEntry>) => (
    <li
      class="scroll-mt-4"
      ref={(element) => {
        const { id } = untrack(entry).suggestion;
        if (id !== props.focusedId) return;

        onElementConnect(element, () => {
          if (id !== props.focusedId || id === scrolledTo) return;

          scrolledTo = id;
          element.scrollIntoView({ block: 'start' });
        });
      }}
    >
      <SuggestionRow
        entry={entry()}
        parts={props.parts}
        hue={hueOf(entry())}
        routineEnabled={(() => {
          const routineId = savedRoutineId(entry().suggestion);
          return routineId ? props.routines.enabled(routineId) : undefined;
        })()}
        onAccept={() => fireAndForget(accept(entry()), 'suggestions.accept')}
        onLook={() =>
          fireAndForget(props.feed.look(entry().suggestion), 'suggestions')
        }
        onOpen={() =>
          fireAndForget(props.feed.open(entry().suggestion), 'suggestions')
        }
        onMarkDone={() =>
          fireAndForget(markDone(entry().suggestion), 'suggestions.done')
        }
        onUndoDone={() =>
          fireAndForget(props.feed.undoDone(entry().suggestion), 'suggestions')
        }
        onStop={() =>
          fireAndForget(props.feed.stop(entry().suggestion), 'suggestions')
        }
        onDismiss={() =>
          fireAndForget(props.feed.dismiss(entry().suggestion), 'suggestions')
        }
        onUndoDismiss={() =>
          fireAndForget(
            props.feed.undoDismiss(entry().suggestion),
            'suggestions'
          )
        }
        onRoutineEnabled={(enabled) => setRoutineEnabled(entry(), enabled)}
      />
    </li>
  );

  // Rows with no topic have a heading only where others have one. A topic
  // shown alone is named by the page.
  const heading = (group: TopicGroup) => {
    if (topic()) return undefined;
    if (group.topic) return group.topic.name;

    return groups().length > 1 ? t('suggestions.everythingElse') : undefined;
  };
  const rowsOf = (group: Accessor<TopicGroup>) => {
    const headingId = createUniqueId();
    return (
      <div
        class={cn(heading(group()) && 'pt-4')}
        role={heading(group()) ? 'group' : undefined}
        aria-labelledby={heading(group()) ? headingId : undefined}
        data-suggestion-group={group().topic?.key ?? ''}
      >
        <Show when={heading(group())}>
          {(name) => (
            <TopicHeading
              id={headingId}
              name={name()}
              reason={group().topic?.reason}
            />
          )}
        </Show>
        <ul class="m-0 flex list-none flex-col p-0">
          <Key each={group().entries} by={(entry) => entry.suggestion.id}>
            {row}
          </Key>
        </ul>
      </div>
    );
  };

  let scroller: HTMLElement | undefined;
  // Each list and topic starts at its top: they share one scroller, and what
  // is shown can change from the sidebar or from history (Back). A feed read
  // that leaves the same one shown moves nothing, and a link to one suggestion
  // scrolls to it instead.
  createEffect(
    on(
      [() => props.list, shownTopicKey],
      () => {
        if (!props.focusedId) scroller?.scrollTo({ top: 0 });
      },
      { defer: true }
    )
  );
  const selectList = (list: ForYouList) => {
    // Choosing the list already shown changes nothing the effect above
    // follows, but still starts it at its top.
    if (list === props.list) scroller?.scrollTo({ top: 0 });
    props.onSelectList(list);
  };
  const selectTopic = (key: string) => {
    if (key === topic()?.key) scroller?.scrollTo({ top: 0 });
    props.onSelectTopic(key);
  };

  return (
    <ViewShell.Root
      asidePreferenceKey="for-you"
      resizable
      aside={{ preserveDuringResize: false }}
      main={{ preferredWidth: 720 }}
    >
      <ViewShell.Aside>
        <ForYouSidebar
          list={topic() ? undefined : props.list}
          counts={props.feed.counts()}
          onSelect={selectList}
          ideas={props.routines.ideas()}
          newIdea={newIdea()}
          routines={props.routines.routines()}
          onOpenRoutines={openRoutines}
          topics={props.feed.topics()}
          topic={topic()?.key}
          onSelectTopic={selectTopic}
        />
      </ViewShell.Aside>
      <ViewShell.Main>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>{name()}</ViewSidebar.Title>
          <div class="ml-auto">
            <ForYouRefresh refresh={props.refresh} />
          </div>
        </ViewShell.TopBar>
        <section
          ref={scroller}
          class="min-h-0 flex-1 overflow-y-auto px-8"
          aria-label={name()}
        >
          <div class="mx-auto flex min-h-full w-full max-w-180 flex-col gap-6 pt-9 pb-16">
            <header class="flex flex-col gap-0.5 px-4">
              <h1 class="min-h-10 text-[34px] leading-10 font-bold tracking-tight">
                {name()}
              </h1>
              <Show when={underName()}>
                {(line) => (
                  <p class="text-base text-ink-muted" data-suggestions-date>
                    {line()}
                  </p>
                )}
              </Show>
            </header>
            <Switch>
              <Match when={view().kind === 'loading'}>
                <FeedSkeleton />
              </Match>
              <Match when={view().kind === 'error'}>
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
                <Show when={caughtUp()}>
                  <CaughtUp
                    done={props.feed.counts()?.done ?? 0}
                    fill={groups().length === 0}
                    onSeeDone={() => selectList('done')}
                    onBrowseRoutines={openRoutines}
                  />
                </Show>
                <Show when={view().kind === 'empty' && props.list !== 'today'}>
                  <p
                    class="px-4 py-5 text-sm text-ink-muted"
                    data-suggestions-empty
                  >
                    {emptyText(props.list)}
                  </p>
                </Show>
                <Key
                  each={groups()}
                  by={(group) => group.topic?.key ?? topic()?.key ?? ''}
                >
                  {rowsOf}
                </Key>
              </Match>
            </Switch>
          </div>
        </section>
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
