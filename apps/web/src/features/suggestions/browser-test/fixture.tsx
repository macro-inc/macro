import '@fontsource-variable/inter';
import '../../../index.css';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { match } from 'ts-pattern';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type {
  RoutinesSource,
  SuggestionActions,
  SuggestionItemParts,
  SuggestionsSource,
} from '../context/suggestions-source';
import { layoutDay } from '../core/day';
import type { Generation } from '../core/generation';
import { FOR_YOU_LISTS, type ForYouList } from '../core/lists';
import type { Suggestion, SuggestionFeed } from '../core/suggestion';
import { createSuggestionsFeed } from '../primitives/feed';
import { createRefresh } from '../primitives/refresh';
import {
  backgroundSuggestion,
  composerSuggestion,
  doneSuggestion,
  draftedReplySuggestion,
  failedSuggestion,
  quietBackgroundSuggestion,
  replySuggestion,
  reviewSuggestion,
  routineSuggestion,
  runningSuggestion,
} from '../tests/fixtures';
import { ForYouView } from '../views/for-you-view';
import { HomePrioritiesView } from '../views/home-priorities-view';

const PARAMS = new URLSearchParams(location.search);
const IS_LIGHT = PARAMS.get('theme') === 'light';
document.documentElement.dataset.themeLight = String(IS_LIGHT);
for (const [token, value] of Object.entries(
  (IS_LIGHT ? macroLightTheme : macroDarkTheme).colorTokens
)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

// The sender has waited two days, whenever the page is opened.
const TWO_DAYS_AGO = new Date(
  Date.now() - 2 * 86_400_000 - 60_000
).toISOString();

const waitingTwoDays = (suggestion: Suggestion): Suggestion =>
  suggestion.kind === 'entity'
    ? { ...suggestion, waitingSince: TWO_DAYS_AGO }
    : suggestion;

const ALL: Suggestion[] = [
  waitingTwoDays(draftedReplySuggestion),
  backgroundSuggestion,
  composerSuggestion,
  // Proposed since the last visit: the sidebar marks Ideas.
  { ...routineSuggestion, isNew: true },
  waitingTwoDays(replySuggestion),
  reviewSuggestion,
  quietBackgroundSuggestion,
  runningSuggestion,
  failedSuggestion,
  doneSuggestion,
];

/** Items by their ids, where the app would read their names and text. */
const PARTS: SuggestionItemParts = {
  Source: (props) => (
    <span class="truncate" data-suggestion-source>
      {props.target.entityType} {props.target.entityId}
      {props.from ? ` · ${props.from}` : ''}
    </span>
  ),
};

/** The feed a server would send for `list`: what waits or runs, then what is done, and the counts. */
function served(list: Suggestion[]): SuggestionFeed {
  const counts = { open: 0, running: 0, failed: 0, done: 0 };
  for (const suggestion of list) counts[suggestion.status] += 1;

  return {
    suggestions: [
      ...list.filter((suggestion) => suggestion.status !== 'done'),
      ...list.filter((suggestion) => suggestion.status === 'done'),
    ],
    counts,
  };
}

const REWRITTEN_AT = '2026-11-09T09:30:00Z';

/** What a finished run says it did. */
const RUN_REPORT = 'Posted the summary in #ops with six confirmed deliveries.';

/** A scripted source: writes are recorded, and a run moves on when told to. */
function Fixture() {
  const scenario = PARAMS.get('scenario');
  const [suggestions, setSuggestions] = createSignal<Suggestion[] | undefined>(
    scenario === 'loading' || scenario === 'error'
      ? undefined
      : scenario === 'empty'
        ? []
        : scenario === 'done'
          ? [doneSuggestion]
          : ALL
  );
  const [failed, setFailed] = createSignal(scenario === 'error');
  const [log, setLog] = createSignal<string[]>([]);
  const record = (line: string) => setLog((lines) => [...lines, line]);
  const change = (id: string, next: (suggestion: Suggestion) => Suggestion) =>
    setSuggestions((list) =>
      list?.map((suggestion) =>
        suggestion.id === id ? next(suggestion) : suggestion
      )
    );

  // Dismissed here, to put back when the dismissal is undone.
  let dismissedHere: Suggestion[] = [];
  // Reply suggestions opened here, which the person's reply makes done.
  const openedReplies = new Set<string>();
  const source: SuggestionsSource = {
    feed: () => {
      const list = suggestions();
      return list ? served(list) : undefined;
    },
    failed,
    retry: () => {
      setFailed(false);
      setSuggestions(ALL);
    },
    refresh: async () => {},
    accept: async ({ id, updatedAt }) => {
      record(`accept ${id}`);
      if (scenario === 'accept-refused') throw new Error('refused');
      if (scenario === 'changed' && updatedAt !== REWRITTEN_AT) {
        // Rewritten under the card: the server refuses and the feed is read again.
        // The rewrite moved where the run posts.
        change(id, (suggestion) =>
          match(suggestion)
            .returnType<Suggestion>()
            .with({ kind: 'prompt' }, (prompt) => ({
              ...prompt,
              summary: 'Rewritten: the team moved the summary to Mondays.',
              sends: 'Posts the weekly status summary in #leadership',
              updatedAt: REWRITTEN_AT,
            }))
            .otherwise((other) => ({ ...other, updatedAt: REWRITTEN_AT }))
        );
        return 'changed';
      }

      change(id, (suggestion) =>
        match(suggestion)
          .returnType<Suggestion>()
          .with({ kind: 'prompt', runMode: 'background' }, (prompt) => ({
            ...prompt,
            status: 'running',
            run: {
              sessionId: `session-${id}`,
              startedAt: '2026-11-09T09:00:00Z',
              stopping: false,
            },
          }))
          // Opening a reply suggestion takes it on; only the reply makes it done.
          .with({ kind: 'entity', action: 'reply' }, (reply) => {
            openedReplies.add(id);
            return { ...reply, isNew: false };
          })
          .otherwise((other) => ({ ...other, status: 'done' }))
      );

      return 'accepted';
    },
    dismiss: async (id) => {
      record(`dismiss ${id}`);
      if (scenario === 'dismiss-refused') throw new Error('refused');

      const gone = suggestions()?.find((suggestion) => suggestion.id === id);
      if (gone) dismissedHere = [...dismissedHere, gone];
      setSuggestions((list) =>
        list?.filter((suggestion) => suggestion.id !== id)
      );
    },
    stop: async (id) => {
      record(`stop ${id}`);
      change(id, (suggestion) =>
        suggestion.kind === 'prompt' &&
        suggestion.runMode === 'background' &&
        suggestion.run
          ? { ...suggestion, run: { ...suggestion.run, stopping: true } }
          : suggestion
      );
    },
    restore: async (id) => {
      record(`restore ${id}`);
      if (scenario === 'restore-refused') throw new Error('too late');

      const back = dismissedHere.find((suggestion) => suggestion.id === id);
      // As the server: a routine suggestion leaves with its idea for good.
      if (back?.kind === 'routine') throw new Error('not restorable');
      if (!back) {
        // Marked done here: Undo opens it again, in its place.
        change(id, (suggestion) => ({
          ...suggestion,
          status: 'open',
          result: undefined,
        }));
        return;
      }
      // A run that the dismissal stopped stays stopped: it comes back open.
      const restored: Suggestion =
        back.status === 'running' ? { ...back, status: 'open' } : back;
      setSuggestions((list) => [restored, ...(list ?? [])]);
    },
    viewed: () => record('viewed'),
  };
  const actions: SuggestionActions = {
    openComposer: async (prompt) => {
      record(`composer ${prompt}`);
    },
    openItem: (target) =>
      record(`open ${target.entityType} ${target.entityId}`),
    openDraft: (draft) => record(`draft ${draft.partId}`),
    reviewRoutine: (id) => record(`review ${id}`),
    turnOnRoutine: async (id) => {
      record(`turn-on ${id}`);
      change('suggestion-routine', (suggestion) => ({
        ...suggestion,
        status: 'done',
        result: { entityType: 'scheduled_action', entityId: 'routine-1' },
      }));
    },
  };
  const feed = createSuggestionsFeed(source, actions);
  // `?generation=`: running, cooldown (ends after `?cooldownMs=`), none (a
  // server that can't say), else idle.
  const cooldownEnd = () =>
    new Date(
      Date.now() + Number(PARAMS.get('cooldownMs') ?? 3_600_000)
    ).toISOString();
  const [generation, setGeneration] = createSignal<Generation | undefined>(
    match(PARAMS.get('generation'))
      .returnType<Generation | undefined>()
      .with('none', () => undefined)
      .with('running', () => ({ state: 'running', trigger: 'nightly' }))
      .with('cooldown', () => ({
        state: 'idle',
        regenerateAvailableAt: cooldownEnd(),
      }))
      .otherwise(() => ({ state: 'idle' }))
  );
  const refresh = createRefresh({
    generation,
    regenerate: async () => {
      record('regenerate');
      if (PARAMS.get('regenerate') === 'fails') throw new Error('refused');

      setGeneration({ state: 'running', trigger: 'manual' });
    },
  });
  /** End the generation, as the server's next status would. */
  const finishGeneration = () =>
    setGeneration({ state: 'idle', regenerateAvailableAt: cooldownEnd() });
  /**
   * Settle the fixture's runs, as the server's next answer would: one asked to
   * stop is open again, and the rest finish with a line saying what they did.
   */
  const finishRuns = () =>
    setSuggestions((list) =>
      list?.map((suggestion): Suggestion => {
        if (
          suggestion.kind !== 'prompt' ||
          suggestion.runMode !== 'background' ||
          suggestion.status !== 'running' ||
          !suggestion.run
        ) {
          return suggestion;
        }
        if (suggestion.run.stopping) {
          return { ...suggestion, status: 'open', run: undefined };
        }

        return {
          ...suggestion,
          status: 'done',
          run: { ...suggestion.run, report: RUN_REPORT },
          result: {
            entityType: 'agent_session',
            entityId: suggestion.run.sessionId,
          },
        };
      })
    );
  // The person's routines: switching one is recorded and kept.
  const [switchedOff, setSwitchedOff] = createSignal<string[]>([]);
  const routines: RoutinesSource = {
    ideas: () => 3,
    routines: () => 6,
    enabled: (routineId) => !switchedOff().includes(routineId),
    setEnabled: async (routineId, enabled) => {
      record(`routine ${routineId} ${enabled ? 'on' : 'off'}`);
      setSwitchedOff((ids) =>
        enabled ? ids.filter((id) => id !== routineId) : [...ids, routineId]
      );
    },
    openRoutines: (routineId) =>
      record(routineId ? `routines ${routineId}` : 'routines'),
  };
  const [list, setList] = createSignal<ForYouList>(
    FOR_YOU_LISTS.find((name) => name === PARAMS.get('list')) ?? 'today'
  );
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('for-you');
  const panel = {
    handle: { isFirst: () => true, isPopover: () => false },
    isPanelActive: () => true,
    splitHotkeyScope: hotkeyScope,
  } as unknown as SplitPanelContextType;

  /** Reply on the opened reply suggestions' threads, as the server's next answer would show. */
  const sendReplies = () =>
    setSuggestions((list) =>
      list?.map((suggestion) =>
        openedReplies.has(suggestion.id)
          ? { ...suggestion, status: 'done' }
          : suggestion
      )
    );

  return (
    <main class="flex h-dvh bg-page p-1.5 font-sans text-ink">
      <ToastRegion />
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel">
        <SplitPanelContext.Provider value={panel}>
          <div ref={attachHotkeys} class="flex min-h-0 flex-1">
            <ForYouView
              feed={feed}
              list={list()}
              onSelectList={setList}
              routines={routines}
              parts={PARTS}
              refresh={refresh}
              focusedId={PARAMS.get('suggestion') ?? undefined}
              onRetry={source.retry}
            />
          </div>
        </SplitPanelContext.Provider>
        <footer class="flex shrink-0 items-center gap-3 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
          <button type="button" onClick={finishRuns}>
            Finish runs
          </button>
          <button type="button" onClick={sendReplies}>
            Send replies
          </button>
          <button type="button" onClick={finishGeneration}>
            Finish generation
          </button>
          <button type="button" onClick={source.viewed}>
            Leave page
          </button>
          <ol aria-label="Requests" class="flex gap-3">
            <For each={log()}>{(line) => <li>{line}</li>}</For>
          </ol>
        </footer>
      </div>
    </main>
  );
}

const NOON = new Date('2026-11-09T12:00:00');
const at = (time: string) => new Date(`2026-11-09T${time}:00`).toISOString();
const EVENTS = [
  { id: 'sync', title: 'Morning sync', start: at('08:00'), end: at('08:30') },
  {
    id: 'review',
    title: 'Design review',
    start: at('11:30'),
    end: at('12:30'),
  },
  {
    id: 'plan',
    title: 'Project planning',
    start: at('14:00'),
    end: at('15:00'),
  },
  {
    id: 'walk',
    title: 'Prototype walkthrough',
    start: at('14:30'),
    end: at('15:30'),
  },
];

// `?day=evening`: a day seen at 18:15, with an event just before now and one
// that starts too close to 20:00 for a chip's full width.
const EVENING = new Date('2026-11-09T18:15:00');
const EVENING_EVENTS = [
  {
    id: 'walkthrough',
    title: 'Routines walkthrough',
    start: at('10:00'),
    end: at('13:00'),
  },
  { id: 'standup', title: 'Standup', start: at('10:15'), end: at('10:45') },
  { id: 'crm', title: 'CRM sync', start: at('10:30'), end: at('11:00') },
  { id: 'one-on-one', title: '1:1', start: at('13:30'), end: at('14:00') },
  { id: 'deploy', title: 'Prod deploy', start: at('18:00'), end: at('18:30') },
  {
    id: 'release',
    title: 'Release check',
    start: at('19:30'),
    end: at('20:00'),
  },
];

function homeToday() {
  if (PARAMS.get('calendar') === 'none') return undefined;
  if (PARAMS.get('day') === 'evening') {
    return { date: EVENING, strip: layoutDay(EVENING_EVENTS, EVENING) };
  }
  return { date: NOON, strip: layoutDay(EVENTS, NOON) };
}

/** Home's section over fixed events and the same suggestions. */
function HomeFixture() {
  const [opened, setOpened] = createSignal('');

  return (
    <main class="h-dvh overflow-y-auto bg-panel p-8 font-sans text-ink">
      <div class="mx-auto max-w-180">
        <HomePrioritiesView
          today={homeToday()}
          priorities={served(ALL).suggestions.slice(0, 5)}
          onOpenEvent={(event) => setOpened(`event ${event.id}`)}
          onOpenSuggestion={(suggestion) =>
            setOpened(`suggestion ${suggestion.id}`)
          }
          onOpenAll={() => setOpened('all')}
        />
        <output aria-label="Opened">{opened()}</output>
      </div>
    </main>
  );
}

const ROOT = document.getElementById('root');
if (ROOT) {
  render(
    () => (PARAMS.get('view') === 'home' ? <HomeFixture /> : <Fixture />),
    ROOT
  );
}
