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
const STEP_ERROR =
  "TypeError: Cannot read properties of undefined (reading 'length')";
const RUN_ERROR = 'The agent could not start: sandbox image unavailable';

const STEP: CodeStepDraft = {
  id: 'count',
  kind: 'code',
  title: 'Count threads',
  summary: 'Counts the newest threads.',
  source: SOURCE,
  knobs: [],
  problems: [PROBLEM],
};

const SLOTS: RoutineStepSlots = {
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
 * Every place a routine shows code, output or an error, as the routine page
 * renders it: a code step (its menu shows the code), a rewritten step with its
 * code changes, a paused routine's reason and proposed update, a run's step
 * output, and a failed run's step and run errors. It scrolls itself, since
 * the app's body doesn't and a drag needs its block on screen.
 */
function Fixture() {
  const [steps, setSteps] = createSignal<StepDraft[]>([STEP]);
  return (
    <div class="@container/routine grid h-screen max-w-3xl content-start gap-8 overflow-y-auto bg-page p-8 text-ink">
      <RoutineSteps
        steps={steps()}
        onChange={setSteps}
        triggers={[]}
        defaultTarget={{ kind: 'model', model: 'm' }}
        slots={SLOTS}
      />
      <StepRevision
        before={{ ...STEP, problems: undefined }}
        after={{ ...STEP, source: REVISED }}
        onKeep={() => {}}
        onUndo={() => {}}
      />
      <CodeReviewNotice
        review={{
          reason: `The proposed update fails type-checking:\n${PROBLEM}`,
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
      <RunDetail
        record={{
          id: 'failed-step',
          success: false,
          steps: [
            {
              path: '0',
              kind: 'code',
              calls: [],
              callsTruncated: false,
              error: STEP_ERROR,
            },
          ],
        }}
        title="Failed step"
        describe={() => 'Count threads'}
      />
      <RunDetail
        record={{ id: 'failed-run', success: false, error: RUN_ERROR }}
        title="Failed run"
        describe={() => 'Count threads'}
      />
    </div>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
