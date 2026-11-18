import PlusIcon from '@icon/system/regular/plus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import {
  MAX_PAYLOAD_TESTS,
  type PayloadTestDraft,
  type PayloadTestOp,
  payloadTestSchema,
} from '../core/routine-triggers';

const operations: { value: PayloadTestOp; label: string }[] = [
  { value: 'equals', label: 'is' },
  { value: 'in', label: 'is one of' },
  { value: 'notIn', label: 'is not one of' },
  { value: 'glob', label: 'matches' },
  { value: 'exists', label: 'is set' },
  { value: 'missing', label: 'is not set' },
];

function valuePlaceholder(op: PayloadTestOp) {
  if (op === 'in' || op === 'notIn') return 'failure, timed_out';
  if (op === 'glob') return 'release/*';
  return 'failure';
}

/**
 * Exact tests on a delivery's JSON payload. They run before anything is
 * queued, so a busy source costs nothing until a delivery passes them all.
 */
export function RoutinePayloadTests(props: {
  tests: PayloadTestDraft[];
  onChange: (tests: PayloadTestDraft[] | undefined) => void;
}) {
  const update = (index: number, patch: Partial<PayloadTestDraft>) =>
    props.onChange(
      props.tests.map((test, i) => (i === index ? { ...test, ...patch } : test))
    );
  const remove = (index: number) => {
    const tests = props.tests.filter((_, i) => i !== index);
    props.onChange(tests.length ? tests : undefined);
  };
  return (
    <div class="mt-3 grid gap-2">
      <p class="text-xs font-medium">Only when the payload</p>
      <For each={props.tests}>
        {(test, index) => (
          <div class="grid grid-cols-[1fr_auto] gap-1">
            <div class="grid min-w-0 grid-cols-[1fr_auto] gap-1">
              <input
                aria-label="Payload field"
                placeholder="workflow_run.conclusion"
                value={test.path}
                onInput={(e) =>
                  update(index(), { path: e.currentTarget.value.trim() })
                }
                class="min-w-0 rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
              />
              <select
                aria-label="Comparison"
                value={test.op}
                onChange={(e) => {
                  const op = payloadTestSchema.shape.op.safeParse(
                    e.currentTarget.value
                  );
                  if (op.success) update(index(), { op: op.data });
                }}
                class="min-w-0 rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                <For each={operations}>
                  {(operation) => (
                    <option value={operation.value}>{operation.label}</option>
                  )}
                </For>
              </select>
              <Show when={test.op !== 'exists' && test.op !== 'missing'}>
                <input
                  aria-label="Value"
                  placeholder={valuePlaceholder(test.op)}
                  value={test.value}
                  onInput={(e) =>
                    update(index(), { value: e.currentTarget.value })
                  }
                  class="col-span-2 min-w-0 rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
                />
              </Show>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove test on ${test.path || 'field'}`}
              onClick={() => remove(index())}
            >
              <XIcon class="size-3.5" />
            </Button>
          </div>
        )}
      </For>
      <Show when={props.tests.length < MAX_PAYLOAD_TESTS}>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-ink-muted hover:text-ink"
          onClick={() =>
            props.onChange([
              ...props.tests,
              { path: '', op: 'equals', value: '' },
            ])
          }
        >
          <PlusIcon class="size-3" /> Add a field test
        </button>
      </Show>
      <p class="text-xs text-ink-extra-muted">
        Fields are keys joined by dots; <code>*</code> checks every item of a
        list, like <code>pull_request.labels.*.name</code>.
      </p>
    </div>
  );
}
