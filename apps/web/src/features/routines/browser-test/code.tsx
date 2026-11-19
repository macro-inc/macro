import '@fontsource-variable/inter';
import '@app/index.css';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { CodeReviewNotice } from '../components/routine-code-review';
import { RunDetail } from '../components/routine-run-detail';
import { StepRevision } from '../components/routine-step-change';
import { RoutineSteps } from '../components/routine-step-editor';
import type { RoutineStepSlots } from '../components/routine-steps';
import type { CodeStepDraft, StepDraft } from '../core/routine-steps';

const SOURCE = `export async function main(macro) {
  const threads = await macro.email.threads.list({ limit: 5 });
  return threads.length;
}`;
const REVISED = SOURCE.replace('limit: 5', 'limit: 10');
const PROBLEM =
  "routine.ts(2,38): error TS2339: Property 'list' does not exist on type 'Threads'.";

const step: CodeStepDraft = {
  id: 'count',
  kind: 'code',
  title: 'Count threads',
  summary: 'Counts the newest threads.',
  source: SOURCE,
  knobs: [],
  problems: [PROBLEM],
};

const slots: RoutineStepSlots = {
  PromptEditor: (props): JSX.Element => (
    <textarea
      aria-label="Instructions"
      value={props.initialValue}
      onInput={(event) => props.onChange(event.currentTarget.value)}
    />
  ),
  ExecutionPicker: () => <span>Model</span>,
};

/**
 * Every place a routine shows code or output, as the routine page renders
 * it: a code step (its menu shows the code), a rewritten step with its code
 * changes, a paused routine's proposed update, and a run's step output.
 */
function Fixture() {
  const [steps, setSteps] = createSignal<StepDraft[]>([step]);
  return (
    <div class="@container/routine grid min-h-screen max-w-3xl gap-8 bg-page p-8 text-ink">
      <RoutineSteps
        steps={steps()}
        onChange={setSteps}
        triggers={[]}
        defaultTarget={{ kind: 'model', model: 'm' }}
        slots={slots}
      />
      <StepRevision
        before={{ ...step, problems: undefined }}
        after={{ ...step, source: REVISED }}
        onKeep={() => {}}
        onUndo={() => {}}
      />
      <CodeReviewNotice
        review={{
          reason: 'The SDK renamed threads.list.',
          sdk: '2',
          proposal: {
            task: { prompt: '', user_prompt: '' },
            changes: [
              { title: 'Count threads', before: SOURCE, after: REVISED },
            ],
          },
        }}
        pending={false}
        onApprove={() => {}}
      />
      <RunDetail
        record={{
          id: 'run',
          success: true,
          steps: [
            {
              path: '0',
              kind: 'code',
              calls: [],
              callsTruncated: false,
              output: { threads: 5, newest: 'Quarterly invoice' },
            },
          ],
        }}
        title="Count threads"
        describe={() => 'Count threads'}
      />
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
