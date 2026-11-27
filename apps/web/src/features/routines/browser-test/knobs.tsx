import '@fontsource-variable/inter';
import '@app/index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { SuggestionCard } from '../../routine-suggestions/components/suggestion-card';
import { RoutineSteps } from '../components/routine-step-editor';
import type { RoutineStepSlots } from '../components/routine-steps';
import { type Knob, type KnobEntityType, withKnobValue } from '../core/knobs';
import type { StepDraft } from '../core/routine-steps';

const SOURCE = 'export async function main(macro, knobs) {\n  return knobs;\n}';

function entity(
  name: string,
  label: string,
  type: KnobEntityType,
  id: string
): Knob {
  return {
    type: 'entity',
    name,
    label,
    entity_types: [type],
    value: { type, id },
  };
}

const ALERT = entity('alert', 'Alert thread', 'email_thread', 'thread-alert');

/**
 * The routine page's steps with every kind of item a knob can name: one step
 * whose sentence lists them all, one whose sentence holds a single long
 * subject, and one whose sentence holds a file name with nowhere to break and
 * that lists the subject, a short item and a link with nowhere to break under
 * Settings. A suggestion card puts the same subject in its smaller sentence.
 */
const STEPS: StepDraft[] = [
  {
    id: 'echo',
    kind: 'code',
    title: 'Echo entity knobs',
    summary: 'Reads each picked item.',
    source: SOURCE,
    sentence:
      'Read {channel}, {document}, {folder}, {person}, {task}, {alert}, {chat}, {company}, {contact}, {project}, {database}, {again}, and return what each points to.',
    knobs: [
      entity('channel', 'Channel', 'channel', 'channel-launch'),
      entity('document', 'Document', 'document', 'document-plan'),
      entity('folder', 'Folder', 'project', 'folder-assets'),
      entity('person', 'Person', 'user', 'macro|avery@example.com'),
      entity('task', 'Task', 'task', 'task-checklist'),
      ALERT,
      entity('chat', 'Chat', 'chat', 'chat-input'),
      entity('company', 'Company', 'crm_company', 'company-northwind'),
      entity('contact', 'Contact', 'crm_contact', 'contact-jordan'),
      entity('project', 'Project', 'initiative', 'initiative-time'),
      entity('database', 'Database', 'database', 'database-feedback'),
      entity('again', 'Channel again', 'channel', 'channel-launch'),
    ],
  },
  {
    id: 'summarize',
    kind: 'code',
    title: 'Summarize the alert',
    summary: 'Summarizes one thread.',
    source: SOURCE,
    sentence: 'Summarize {alert} every morning.',
    knobs: [ALERT],
  },
  {
    id: 'digest',
    kind: 'code',
    title: 'Post a digest',
    summary: 'Posts a digest.',
    source: SOURCE,
    sentence: 'Post a digest in {channel} with {file}.',
    knobs: [
      entity('channel', 'Channel', 'channel', 'channel-launch'),
      entity('file', 'File', 'document', 'document-export'),
      ALERT,
      entity('folder', 'Folder', 'project', 'folder-assets'),
      {
        type: 'text',
        name: 'hook',
        label: 'Webhook',
        value: 'https://example.com/hooks/launchdigest',
      },
    ],
  },
];

const SLOTS: RoutineStepSlots = {
  PromptEditor: () => <span />,
  ExecutionPicker: () => <span />,
};

// What the app's boot writes; `touch:` styles read it.
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);

function Fixture() {
  const [steps, setSteps] = createSignal<StepDraft[]>(STEPS);
  const [knobs, setKnobs] = createSignal([ALERT]);
  return (
    <div class="@container/routine grid h-screen max-w-3xl content-start gap-8 overflow-y-auto bg-page p-4 text-ink sm:p-8">
      <RoutineSteps
        steps={steps()}
        onChange={setSteps}
        triggers={[]}
        defaultTarget={{ kind: 'model', model: 'm' }}
        slots={SLOTS}
      />
      <ul class="grid grid-cols-2 gap-3" aria-label="Suggestions">
        <SuggestionCard
          on="page"
          model={{
            title: 'Summarize alert threads',
            look: 'email',
            surface: 'email',
            chain: {
              trigger: 'Every morning',
              action: 'Summarize',
              actionAi: false,
            },
            sentence: {
              sentence: 'Summarize {alert} every morning.',
              knobs: knobs(),
            },
            summary: '',
            action: 'use',
            status: { kind: 'idle' },
            picked: false,
            drafted: false,
            template: true,
          }}
          onOpen={() => {}}
          onTurnOn={() => {}}
          onKnob={(name, value) =>
            setKnobs(withKnobValue(knobs(), name, value))
          }
        />
      </ul>
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
