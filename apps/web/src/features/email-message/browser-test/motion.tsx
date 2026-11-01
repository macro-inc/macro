import '@app/index.css';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { MessageCard } from '../components/message-card';

function MotionPreview() {
  const [draftOpen, setDraftOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [chainOpen, setChainOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(
    'Sounds good — I will send the updated proposal tomorrow.'
  );
  return (
    <main class="min-h-screen bg-page text-ink p-6">
      <div class="mx-auto max-w-3xl">
        <h1 class="text-2xl font-semibold mb-2">Email motion preview</h1>
        <p class="text-sm text-ink-muted mb-8">
          Local sample content. Try opening and closing quickly.
        </p>
        <div class="flex flex-col gap-2">
          <MessageCard
            messageId="chain-start"
            isSelected={false}
            allowHover
            isTouch={false}
          >
            <div class="flex justify-between gap-4">
              <span class="font-medium">Alex</span>
              <button
                data-button
                type="button"
                aria-expanded={expanded()}
                onClick={() => setExpanded(!expanded())}
              >
                {expanded() ? 'Collapse message' : 'Expand message'}
              </button>
            </div>
            <Show
              when={expanded()}
              fallback={
                <p class="truncate text-ink-muted">
                  Here is the updated proposal for next week.
                </p>
              }
            >
              <div class="space-y-4 pt-4">
                <p>Here is the updated proposal for next week.</p>
                <p>
                  We have incorporated the feedback from the last review. The
                  draft now includes the timeline, the new layout, and the
                  remaining questions.
                </p>
                <p>
                  Let me know what you think before we share it with the team.
                </p>
                <p>
                  Thanks,
                  <br />
                  Alex
                </p>
              </div>
            </Show>
          </MessageCard>
          <button
            class="py-2 text-sm text-ink-muted"
            aria-expanded={chainOpen()}
            onClick={() => setChainOpen(!chainOpen())}
          >
            {chainOpen() ? 'Hide earlier messages' : 'Show 3 hidden messages'}
          </button>
          <For each={['Tuesday', 'Wednesday', 'Thursday']}>
            {(day) => (
              <CollapseTransition open={chainOpen()}>
                <div class="w-full shrink-0">
                  <MessageCard
                    messageId={day}
                    isSelected={false}
                    allowHover
                    isTouch={false}
                  >
                    <div class="font-medium">Alex · {day}</div>
                    <p class="text-ink-muted">
                      A follow-up about the proposal.
                    </p>
                  </MessageCard>
                </div>
              </CollapseTransition>
            )}
          </For>
          <MessageCard
            messageId="draft"
            isSelected={false}
            allowHover
            isTouch={false}
          >
            <div class="font-medium">Sam</div>
            <p class="py-4">
              Looks good. Can you send the final version tomorrow?
            </p>
            <div class="border-t border-edge-muted pt-3">
              <Show
                when={draftOpen()}
                fallback={
                  <button
                    data-button
                    type="button"
                    class="w-full text-left text-ink-muted"
                    onClick={() => setDraftOpen(true)}
                  >
                    <span class="font-medium text-warning">Draft</span> ·{' '}
                    {draft()}
                  </button>
                }
              >
                <div class="flex justify-between text-sm text-ink-muted mb-3">
                  <span>To: Sam</span>
                  <button
                    data-button
                    type="button"
                    onClick={() => setDraftOpen(false)}
                  >
                    Collapse draft
                  </button>
                </div>
                <textarea
                  aria-label="Draft reply"
                  class="block w-full min-h-40 resize-y bg-transparent outline-none"
                  value={draft()}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                />
                <p class="text-xs text-ink-muted">
                  Preview only — nothing is saved or sent.
                </p>
              </Show>
            </div>
          </MessageCard>
        </div>
      </div>
    </main>
  );
}

render(() => <MotionPreview />, document.getElementById('root')!);
