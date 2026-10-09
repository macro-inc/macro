import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { InputDisplay } from '../context/capabilities';
import {
  draftSchema,
  type Intent,
  intents,
  type Submission,
} from '../core/input';
import { resolveRecipients } from '../core/recipients';
import { createUniversalInput } from '../primitives/universal-input';
import { UniversalComposer } from '../views/universal-composer';

/** Real view and controller with deterministic inference and recording-only writes. */
function Fixture() {
  const [sent, setSent] = createSignal<Submission[]>([]);
  const people = [
    {
      id: 'john',
      kind: 'user' as const,
      label: 'John Adams',
      email: 'john@example.com',
    },
  ];
  const actions: InputDisplay = {
    people: () => people,
    destinations: () => people,
    recipients: (fields) => resolveRecipients(fields.recipients, people, true),
    calendars: () => [
      { id: 'calendar', name: 'Personal', emailAddress: 'you@example.com' },
    ],
    selectedCalendar: () => ({ id: 'calendar' }),
    inboxes: () => [{ id: 'inbox', email_address: 'you@example.com' }],
    selectedInbox: () => ({ id: 'inbox' }),
    roster: () => [{ id: 'macro', name: 'Macro' }],
    agentsEnabled: () => true,
    models: () => [],
    model: () => '',
    attachmentCount: () => 0,
    clearAttachments: () => {},
  };
  const state = createUniversalInput({
    async classify(text, revision) {
      await new Promise((r) => setTimeout(r, 80));
      const intent: Intent = text.toLowerCase().startsWith('email')
        ? 'email'
        : text.includes('3pm')
          ? 'calendar'
          : text.includes('find')
            ? 'search'
            : 'note';
      return {
        revision,
        scores: intents.map((i) => ({
          intent: i,
          score: i === intent ? 0.98 : 0.01,
        })),
      };
    },
    async extract(text, intent, revision) {
      await new Promise((r) => setTimeout(r, 80));
      return {
        revision,
        intent,
        suggestions: {
          title: intent === 'calendar' ? 'Call John' : text,
          body: intent === 'email' ? 'I’ll be late' : text,
          subject: 'Running late',
          recipients:
            intent === 'email' || intent === 'message' ? ['John'] : [],
          start: '2026-10-10T15:00',
          end: '2026-10-10T16:00',
          query: text,
          guests: [],
        },
      };
    },
    async submit(input) {
      setSent((s) => [...s, input]);
      return { message: `${input.intent} completed` };
    },
    validate: () => undefined,
    readDraft: () => {
      const value = localStorage.getItem('fixture-draft');
      return value ? draftSchema.parse(JSON.parse(value)) : undefined;
    },
    saveDraft: (draft) =>
      localStorage.setItem('fixture-draft', JSON.stringify(draft)),
  });
  return (
    <main class="min-h-screen bg-page p-12 text-ink">
      <div class="mx-auto max-w-180">
        <UniversalComposer
          state={state}
          actions={actions}
          taskFields={<span>Task properties</span>}
        />
        <output data-testid="submission-count">{sent().length}</output>
        <pre data-testid="last-submission">{JSON.stringify(sent().at(-1))}</pre>
      </div>
    </main>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
