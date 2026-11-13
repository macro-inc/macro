import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { match } from 'ts-pattern';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type {
  SuggestionActions,
  SuggestionItemParts,
  SuggestionsSource,
} from '../context/suggestions-source';
import { layoutDay } from '../core/day';
import type { Generation } from '../core/generation';
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
  routineSuggestion,
  waitingTwoDays(replySuggestion),
  quietBackgroundSuggestion,
  runningSuggestion,
  failedSuggestion,
  doneSuggestion,
];

/** Items by their ids, where the app would read their names and text. */
const PARTS: SuggestionItemParts = {
  Source: (props) => (
    <button type="button" data-suggestion-source onClick={() => props.onOpen()}>
      {props.from ? `${props.from} · ` : ''}
      {props.target.entityType} {props.target.entityId}
    </button>
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

/** A scripted source: writes are recorded, and a run moves on when told to. */
function Fixture() {
  const scenario = PARAMS.get('scenario');
  const [suggestions, setSuggestions] = createSignal<Suggestion[] | undefined>(
    scenario === 'loading' || scenario === 'error'
      ? undefined
      : scenario === 'empty'
        ? []
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
      if (scenario === 'changed' && updatedAt !== REWRITTEN_AT) {
        // Rewritten under the card: the server refuses and the feed is read again.
        change(id, (suggestion) => ({
          ...suggestion,
          summary: 'Rewritten: the team moved the summary to Mondays.',
          updatedAt: REWRITTEN_AT,
        }));
        return 'changed';
      }

      change(id, (suggestion) =>
        suggestion.kind === 'prompt' && suggestion.runMode === 'background'
          ? {
              ...suggestion,
              status: 'running',
              run: {
                sessionId: `session-${id}`,
                startedAt: '2026-11-09T09:00:00Z',
              },
            }
          : { ...suggestion, status: 'done' }
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
    restore: async (id) => {
      record(`restore ${id}`);
      if (scenario === 'restore-refused') throw new Error('too late');

      const back = dismissedHere.find((suggestion) => suggestion.id === id);
      if (!back) return;
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
    routineText: () => ({
      title: 'Weekly vendor digest',
      sentence: [
        { text: 'Every ', picked: false },
        { text: 'Friday', picked: true },
        { text: ' at ', picked: false },
        { text: '9:00 AM', picked: true },
        {
          text: ', list the deliveries vendors confirmed this week and post it to ',
          picked: false,
        },
        { text: '#ops', picked: true },
        { text: '.', picked: false },
      ],
      when: 'Fridays at 9:00 AM',
    }),
    reviewRoutine: (id) => record(`review ${id}`),
    turnOnRoutine: async (id) => {
      record(`turn-on ${id}`);
      change('suggestion-routine', (suggestion) => ({
        ...suggestion,
        status: 'done',
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
  /** Finish the fixture's runs, as the server's next answer would. */
  const finishRuns = () =>
    setSuggestions((list) =>
      list?.map((suggestion) =>
        suggestion.kind === 'prompt' &&
        suggestion.runMode === 'background' &&
        suggestion.status === 'running' &&
        suggestion.run
          ? {
              ...suggestion,
              status: 'done',
              result: {
                entityType: 'agent_session',
                entityId: suggestion.run.sessionId,
              },
            }
          : suggestion
      )
    );

  return (
    <main class="flex h-dvh bg-page p-1.5 font-sans text-ink">
      <div class="flex min-w-0 flex-1 flex-col rounded-xl border border-edge-muted bg-panel">
        <ForYouView
          feed={feed}
          actions={actions}
          parts={PARTS}
          refresh={refresh}
          focusedId={PARAMS.get('suggestion') ?? undefined}
          onRetry={source.retry}
        />
        <footer class="flex shrink-0 items-center gap-3 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
          <button type="button" onClick={finishRuns}>
            Finish runs
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

/** Home's section over fixed events and the same suggestions. */
function HomeFixture() {
  const [opened, setOpened] = createSignal('');

  return (
    <main class="h-dvh overflow-y-auto bg-panel p-8 font-sans text-ink">
      <div class="mx-auto max-w-180">
        <HomePrioritiesView
          today={
            PARAMS.get('calendar') === 'none'
              ? undefined
              : { date: NOON, strip: layoutDay(EVENTS, NOON) }
          }
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
