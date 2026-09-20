/**
 * Debug gallery for the Changes pane: the real controller and views over an
 * in-memory source, so the split, tree, Pierre diffs, review notes, and the
 * pull request link can be exercised without a backend. Registered as the
 * `agent-changes-ui` component.
 */

import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { AgentChangesControllerProvider } from '../context/agent-changes-controller';
import { createAgentChanges } from '../primitives/create-agent-changes';
import { createMockAgentChangesContext } from '../tests/mock-context';
import { createUrlDiffState } from '../url-diff-state';
import { AgentChangesSplit } from '../views/AgentChangesSplit';
import {
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from '../views/SessionChangesControls';
import { GALLERY_PATCH, gallerySummary } from './gallery-fixture';

export default function AgentChangesGallery() {
  const context = createMockAgentChangesContext({
    summary: gallerySummary(),
    patch: GALLERY_PATCH,
    sessionId: 'gallery-session',
  });
  const urlState = createUrlDiffState(context.host.scopeKey);
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context,
    paneLayout: [urlState.layout, urlState.setLayout],
    diffStyle: [urlState.diffStyle, urlState.setDiffStyle],
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
  // The mock host records prompts; surface them like a transcript would.
  const originalSend = context.host.agent.send;
  context.host.agent.send = (markdown) => {
    originalSend(markdown);
    setTranscript((lines) => [...lines, markdown]);
  };

  return (
    <AgentChangesControllerProvider value={controller}>
      <div class="flex h-full min-h-0 flex-col bg-panel">
        <AgentChangesSplit>
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
            <div class="rounded-2xl border border-edge px-4 py-3 text-sm text-ink-placeholder">
              Message the agent, @mention anything
            </div>
          </div>
        </AgentChangesSplit>
      </div>
    </AgentChangesControllerProvider>
  );
}
