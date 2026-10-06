/**
 * Debug gallery for the Changes pane: the real controller and views over an
 * in-memory source, so the split, tree, Pierre diffs, review notes, and the
 * pull request link can be exercised without a backend. Registered as the
 * `agent-changes-ui` component.
 */

import { SAMPLE_PATCH } from '@app/components/diff-view/debug/fixtures';
import { QueuedPrompts } from '@app/features/block-agent/ui';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { ChangesControllerProvider } from '../context/changes-controller';
import { createPaneViewState } from '../pane-view-state';
import { createChanges } from '../primitives/create-changes';
import { createMockChangesContext } from '../tests/mock-context';
import {
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from '../views/ChangesControls';
import { ChangesSplit } from '../views/ChangesSplit';
import { gallerySummary } from './gallery-fixture';

const GALLERY_QUEUE = Array.from({ length: 12 }, (_, index) => ({
  actionId: `gallery-queued-${index + 1}`,
  kind: 'prompt',
  prompt:
    index === 0
      ? [
          'Add regression coverage for queued messages and review readiness.',
          ...Array.from(
            { length: 12 },
            (_, step) =>
              `Scenario ${step + 1}: queue a follow-up while the agent is working. Verify that the next prompt stays reachable and editing a queued message preserves its attachments.`
          ),
        ].join('\n\n')
      : `Queued follow-up #${index + 1}: tighten the unread rail query.`,
}));

export default function ChangesGallery() {
  const context = createMockChangesContext({
    summary: gallerySummary(),
    patch: SAMPLE_PATCH,
    sessionId: 'gallery-session',
  });
  const view = createPaneViewState();
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createChanges({
    context,
    view,
    dismissed: [dismissed, setDismissed],
  });
  if (controller.review.queued().length === 0) {
    controller.review.addNote(
      {
        path: 'apps/web/src/features/block-agent/state/unread.ts',
        side: 'additions',
        lineNumber: 8,
        endLineNumber: 8,
      },
      'Keep archived sessions off the unread rail.'
    );
    controller.review.addNote(
      {
        path: 'crates/macro_agent_sessions/src/service.rs',
        side: 'additions',
        lineNumber: 88,
        endLineNumber: 92,
      },
      'Mark the session read in the same transaction as the archive.'
    );
  }
  const [transcript, setTranscript] = createSignal<string[]>([]);
  const [queued, setQueued] = createSignal(false);
  const [queueItems, setQueueItems] = createSignal(GALLERY_QUEUE);
  // The mock host records prompts; surface them like a transcript would.
  const originalSend = context.host.agent.send;
  context.host.agent.send = (markdown) => {
    originalSend(markdown);
    setTranscript((lines) => [...lines, markdown]);
  };

  return (
    <ChangesControllerProvider value={controller}>
      <div class="flex h-full min-h-0 flex-col bg-panel">
        <ChangesSplit>
          <header class="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
            <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              Stale unread dots on archived sessions
            </h2>
            <ChangesToggle />
          </header>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p class="text-xs text-ink-muted">
              Gallery session. Prompts sent from the Changes pane appear below;
              use the button below to simulate linking a pull request.
            </p>
            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                class="self-start"
                onClick={() =>
                  context.setPullRequestUrl(
                    'https://github.com/macro-inc/macro/pull/1482'
                  )
                }
              >
                Simulate the agent linking PR #1482
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="self-start"
                aria-pressed={queued()}
                onClick={() => {
                  setQueueItems(GALLERY_QUEUE);
                  setQueued((value) => !value);
                }}
              >
                {queued() ? 'Hide queued messages' : 'Show a long queue'}
              </Button>
            </div>
            <For each={transcript()}>
              {(line) => (
                <pre class="rounded-lg bg-surface-1 p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted">
                  {line}
                </pre>
              )}
            </For>
          </div>
          <div class="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 pb-4">
            <ChangesHandoff />
            <ReviewNotesDock />
            <Show when={queued()}>
              <QueuedPrompts
                items={queueItems()}
                onEdit={(id, prompt) =>
                  setQueueItems((items) =>
                    items.map((item) =>
                      item.actionId === id ? { ...item, prompt } : item
                    )
                  )
                }
                onRemove={(id) => {
                  const remaining = queueItems().filter(
                    (item) => item.actionId !== id
                  );
                  setQueueItems(remaining);
                  if (remaining.length === 0) setQueued(false);
                }}
                onSteer={(id) =>
                  setQueueItems((items) => {
                    const index = items.findIndex(
                      (item) => item.actionId === id
                    );
                    if (index < 0) return items;
                    const next = items.slice();
                    const [entry] = next.splice(index, 1);
                    if (!entry) return items;
                    next.unshift(entry);
                    return next;
                  })
                }
              />
            </Show>
            <div class="rounded-2xl border border-edge px-4 py-3 text-sm text-ink-placeholder">
              Message the agent, @mention anything
            </div>
          </div>
        </ChangesSplit>
      </div>
    </ChangesControllerProvider>
  );
}
