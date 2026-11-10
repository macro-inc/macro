import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import type { IdeaActions, IdeasSource } from '../context/ideas-source';
import type { Idea } from '../core/idea';
import { createIdeasFeed } from '../primitives/feed';
import {
  backgroundIdea,
  composerIdea,
  doneIdea,
  draftedReplyIdea,
  failedIdea,
  quietBackgroundIdea,
  replyIdea,
  routineIdea,
  runningIdea,
} from '../tests/fixtures';
import { ForYouView } from '../views/for-you-view';

const PARAMS = new URLSearchParams(location.search);
const IS_LIGHT = PARAMS.get('theme') === 'light';
document.documentElement.dataset.themeLight = String(IS_LIGHT);
for (const [token, value] of Object.entries(
  (IS_LIGHT ? macroLightTheme : macroDarkTheme).colorTokens
)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const ALL: Idea[] = [
  draftedReplyIdea,
  backgroundIdea,
  composerIdea,
  routineIdea,
  replyIdea,
  quietBackgroundIdea,
  runningIdea,
  failedIdea,
  doneIdea,
];

/** A scripted source: writes are recorded, and a run moves on when told to. */
function Fixture() {
  const scenario = PARAMS.get('scenario');
  const [ideas, setIdeas] = createSignal<Idea[] | undefined>(
    scenario === 'loading' || scenario === 'error'
      ? undefined
      : scenario === 'empty'
        ? []
        : ALL
  );
  const [failed, setFailed] = createSignal(scenario === 'error');
  const [log, setLog] = createSignal<string[]>([]);
  const record = (line: string) => setLog((lines) => [...lines, line]);
  const change = (id: string, next: (idea: Idea) => Idea) =>
    setIdeas((list) =>
      list?.map((idea) => (idea.id === id ? next(idea) : idea))
    );

  const source: IdeasSource = {
    ideas,
    failed,
    retry: () => {
      setFailed(false);
      setIdeas(ALL);
    },
    accept: async (id) => {
      record(`accept ${id}`);
      change(id, (idea) =>
        idea.kind === 'prompt' && idea.runMode === 'background'
          ? {
              ...idea,
              state: 'accepted',
              run: {
                sessionId: `session-${id}`,
                startedAt: '2026-11-09T09:00:00Z',
                progress: 'running',
              },
            }
          : { ...idea, state: 'done' }
      );
    },
    dismiss: async (id) => {
      record(`dismiss ${id}`);
      setIdeas((list) => list?.filter((idea) => idea.id !== id));
    },
  };
  const actions: IdeaActions = {
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
      change('idea-routine', (idea) => ({ ...idea, state: 'done' }));
    },
  };
  const feed = createIdeasFeed(source, actions, {
    lastSeenAt: () => '2026-11-09T05:00:00Z',
    focusedId: () => PARAMS.get('idea') ?? undefined,
  });
  /** Finish the fixture's runs, as the server's next answer would. */
  const finishRuns = () =>
    setIdeas((list) =>
      list?.map((idea) =>
        idea.kind === 'prompt' &&
        idea.runMode === 'background' &&
        idea.run?.progress === 'running'
          ? {
              ...idea,
              state: 'done',
              run: { ...idea.run, progress: 'finished' },
              produced: [
                { entityType: 'agent_session', entityId: idea.run.sessionId },
              ],
            }
          : idea
      )
    );

  return (
    <main class="flex h-dvh bg-page p-1.5 font-sans text-ink">
      <div class="flex min-w-0 flex-1 flex-col rounded-xl border border-edge-muted bg-panel">
        <ForYouView
          feed={feed}
          actions={actions}
          focusedId={PARAMS.get('idea') ?? undefined}
          onRetry={source.retry}
        />
        <footer class="flex shrink-0 items-center gap-3 border-t border-edge-muted px-4 py-2 text-xs text-ink-muted">
          <button type="button" onClick={finishRuns}>
            Finish runs
          </button>
          <button type="button" onClick={feed.sendDismissals}>
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

const ROOT = document.getElementById('root');
if (ROOT) render(() => <Fixture />, ROOT);
