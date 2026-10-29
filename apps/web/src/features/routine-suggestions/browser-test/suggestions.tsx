import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { RoutineSuggestionsCard } from '../components/routine-suggestions-card';
import { RoutineSuggestionsDialog } from '../components/routine-suggestions-dialog';
import { createSuggestionActions } from '../primitives/suggestion-actions';
import { toRoutineSuggestions } from '../queries/suggestion-wire';
import { FIXTURE_ROUTINE_SUGGESTIONS } from '../tests/fixture-suggestions';
import {
  SuggestionRows,
  suggestionListView,
} from '../views/suggestion-list-view';

// The real card, modal, and rows over the fixture's email suggestions. Creating a
// routine records the draft instead of calling the server; the first create
// fails once so the retry path can be exercised.
const suggestions = toRoutineSuggestions(
  FIXTURE_ROUTINE_SUGGESTIONS,
  'America/New_York'
).filter((suggestion) => suggestion.surface === 'email');
const [created, setCreated] = createSignal<string[]>([]);
let failNext = true;

function Fixture() {
  const [open, setOpen] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const actions = createSuggestionActions({
    target: () => ({ kind: 'model', model: 'fixture/model' }),
    existingRoutines: () => [],
    async create(draft) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (failNext) {
        failNext = false;
        throw new Error('The server is busy.');
      }
      setCreated((names) => [...names, draft.name]);
      return `routine-${created().length}`;
    },
    customize: (draft) =>
      setCreated((names) => [...names, `edit:${draft.name}`]),
  });
  return (
    <main class="flex min-h-screen bg-page">
      <aside
        class="flex w-64 shrink-0 flex-col gap-3 bg-panel px-2 py-3"
        aria-label="Email sidebar"
      >
        <p class="px-2 text-sm font-semibold text-ink">Email</p>
        <Show when={!dismissed()}>
          <RoutineSuggestionsCard
            teaser={suggestions[0]?.title ?? ''}
            more={suggestions.length - 1}
            onOpen={() => setOpen(true)}
            onDismiss={() => setDismissed(true)}
          />
        </Show>
        <p class="px-2 text-sm text-ink-muted">Inbox</p>
      </aside>
      <output aria-label="Created routines" class="p-6 text-xs text-ink-muted">
        {created().join(' | ')}
      </output>
      <RoutineSuggestionsDialog
        open={open()}
        onOpenChange={setOpen}
        title="Routines for Email"
        refreshing={false}
        onRefresh={() => {}}
        onSeeAll={() => setOpen(false)}
      >
        <SuggestionRows
          view={suggestionListView({
            suggestions,
            generating: false,
            failed: false,
          })}
          actions={actions}
          emptyLabel="No email routines to suggest yet."
          onRetry={() => {}}
          onOpenRoutine={() => setOpen(false)}
        />
      </RoutineSuggestionsDialog>
    </main>
  );
}

applyTheme(
  new URLSearchParams(location.search).get('theme') === 'dark'
    ? 'Macro Dark'
    : 'Macro Light'
);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
