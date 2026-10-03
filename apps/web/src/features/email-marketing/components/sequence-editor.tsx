import EnvelopeIcon from '@phosphor/envelope.svg';
import FlowArrowIcon from '@phosphor/flow-arrow.svg';
import { For, Show } from 'solid-js';
import type { Campaign, Sender, SequenceStep } from '../core/model';

const fieldClass =
  'w-full rounded-lg border border-edge-muted bg-input px-3 py-2 text-sm text-ink placeholder:text-ink-placeholder focus:border-accent focus:outline-none disabled:opacity-60';
export function SequenceEditor(props: {
  campaign: Campaign;
  senders: Sender[];
  disabled: boolean;
  onChange: (campaign: Campaign) => void;
  onPreview: (step: SequenceStep) => void;
}) {
  const change = (patch: Partial<Campaign>) =>
    props.onChange({ ...props.campaign, ...patch });
  const changeStep = (id: string, patch: Partial<SequenceStep>) =>
    change({
      steps: props.campaign.steps.map((step) =>
        step.id === id ? { ...step, ...patch } : step
      ),
    });
  return (
    <div class="mx-auto w-full max-w-3xl space-y-7 pb-12">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="space-y-2 text-xs font-medium">
          Campaign name
          <input
            aria-label="Campaign name"
            class={fieldClass}
            value={props.campaign.name}
            disabled={props.disabled}
            onInput={(event) => change({ name: event.currentTarget.value })}
          />
        </label>
        <label class="space-y-2 text-xs font-medium">
          Send from
          <select
            aria-label="Send from"
            class={fieldClass}
            value={props.campaign.senderId}
            disabled={props.disabled}
            onChange={(event) =>
              change({ senderId: event.currentTarget.value })
            }
          >
            <option value="">Choose a Gmail inbox</option>
            <For each={props.senders}>
              {(sender) => (
                <option value={sender.id} disabled={!sender.ready}>
                  {sender.email}
                  {sender.ready ? '' : ' · reconnect required'}
                </option>
              )}
            </For>
          </select>
        </label>
      </div>
      <label class="block space-y-2 text-xs font-medium">
        Description <span class="font-normal text-ink-muted">optional</span>
        <input
          aria-label="Campaign description"
          class={fieldClass}
          value={props.campaign.description}
          disabled={props.disabled}
          placeholder="What does this sequence help people do?"
          onInput={(event) =>
            change({ description: event.currentTarget.value })
          }
        />
      </label>
      <div class="flex items-center gap-3 rounded-lg border border-edge-muted px-4 py-3">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <FlowArrowIcon class="size-4" aria-hidden="true" />
        </span>
        <div>
          <p class="text-sm font-medium">Contact is enrolled</p>
          <p class="text-xs text-ink-muted">
            Choose contacts and a start time when you enroll them.
          </p>
        </div>
      </div>
      <For each={props.campaign.steps}>
        {(step, index) => (
          <div>
            <div class="ml-7 h-5 border-l border-dashed border-edge" />
            <article
              class="overflow-hidden rounded-xl border border-edge-muted bg-page"
              aria-label={`Email ${index() + 1}`}
            >
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge-muted bg-panel/40 px-5 py-3">
                <div class="flex items-center gap-3">
                  <span class="flex size-7 items-center justify-center rounded-lg border border-edge text-sm text-ink-muted">
                    <EnvelopeIcon class="size-4" aria-hidden="true" />
                  </span>
                  <h3 class="text-sm font-medium">Email {index() + 1}</h3>
                </div>
                <div class="flex items-center gap-3">
                  <button
                    type="button"
                    class="text-xs text-ink-muted hover:text-ink"
                    onClick={() => props.onPreview(step)}
                  >
                    Preview
                  </button>
                  <Show when={!props.disabled}>
                    <button
                      type="button"
                      aria-label={`Move email ${index() + 1} up`}
                      disabled={index() === 0}
                      class="text-xs text-ink-muted disabled:opacity-30"
                      onClick={() => {
                        const steps = [...props.campaign.steps];
                        const at = index();
                        [steps[at - 1], steps[at]] = [steps[at], steps[at - 1]];
                        change({ steps });
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove email ${index() + 1}`}
                      class="text-xs text-ink-muted hover:text-failure"
                      onClick={() =>
                        change({
                          steps: props.campaign.steps.filter(
                            (item) => item.id !== step.id
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </Show>
                </div>
              </div>
              <div class="space-y-4 p-5">
                <label class="flex items-center gap-2 text-xs text-ink-muted">
                  Wait
                  <input
                    aria-label={`Email ${index() + 1} delay days`}
                    type="number"
                    min="0"
                    max="365"
                    class="w-16 rounded-md border border-edge-muted bg-input px-2 py-1 text-ink"
                    value={step.delayDays}
                    disabled={props.disabled}
                    onInput={(event) =>
                      changeStep(step.id, {
                        delayDays: Number(event.currentTarget.value),
                      })
                    }
                  />
                  days{' '}
                  {index() === 0
                    ? 'after enrollment starts'
                    : 'after the previous email'}
                </label>
                <label class="block space-y-2 text-xs font-medium">
                  Subject
                  <input
                    aria-label={`Email ${index() + 1} subject`}
                    class={fieldClass}
                    placeholder="A subject worth opening"
                    value={step.subject}
                    disabled={props.disabled}
                    onInput={(event) =>
                      changeStep(step.id, {
                        subject: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label class="block space-y-2 text-xs font-medium">
                  Message
                  <textarea
                    aria-label={`Email ${index() + 1} message`}
                    class={`${fieldClass} min-h-36 resize-y leading-6`}
                    placeholder="Hi {{firstName}},"
                    value={step.body}
                    disabled={props.disabled}
                    onInput={(event) =>
                      changeStep(step.id, { body: event.currentTarget.value })
                    }
                  />
                </label>
                <p class="text-xs text-ink-muted">
                  Personalize with <code>{'{{firstName}}'}</code>,{' '}
                  <code>{'{{name}}'}</code>, or <code>{'{{email}}'}</code>.
                </p>
              </div>
            </article>
          </div>
        )}
      </For>
      <Show when={!props.disabled}>
        <button
          type="button"
          class="w-full rounded-xl border border-dashed border-edge px-4 py-3 text-sm text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50"
          disabled={props.campaign.steps.length >= 20}
          onClick={() =>
            change({
              steps: [
                ...props.campaign.steps,
                {
                  id: crypto.randomUUID(),
                  delayDays: props.campaign.steps.length ? 2 : 0,
                  subject: '',
                  body: '',
                },
              ],
            })
          }
        >
          ＋ Add email
        </button>
      </Show>
      <div class="flex items-center gap-3 rounded-lg bg-panel/50 px-4 py-3">
        <span class="text-success">✓</span>
        <div>
          <p class="text-sm font-medium">Sequence ends</p>
          <p class="text-xs text-ink-muted">
            Replies and unsubscribe requests are handled manually in v1.
          </p>
        </div>
      </div>
    </div>
  );
}
