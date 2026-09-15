/**
 * Debug gallery for the Changes pane: the real controller and views over an
 * in-memory source, so the split, tree, Pierre diffs, review notes, and the
 * pull request flow can be exercised without a backend. Registered as the
 * `agent-changes-ui` component.
 */

import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { AgentChangesControllerProvider } from '../context/agent-changes-controller';
import {
  createAgentChanges,
  type DiffStyle,
} from '../primitives/create-agent-changes';
import { createMockAgentChangesContext } from '../tests/mock-context';
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
    draft: {
      title: 'Clear the unread dot when an agent session is archived',
      body: [
        'Archiving an agent session left its unread marker in place, so the rail kept a dot for a session the user had already put away.',
        '',
        '- `hasUnreadActivity` is now the one predicate both surfaces read.',
        '- Archiving moves the read marker in the same transaction as the archive.',
        '',
        '## Test plan',
        '- `bun test apps/web/src/features/block-agent/state/unread.test.ts`',
        '- `cargo test -p macro_agent_sessions`',
      ].join('\n'),
    },
    sessionId: 'gallery-session',
  });
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context,
    diffStyle: [diffStyle, setDiffStyle],
    dismissed: [dismissed, setDismissed],
  });
  const [transcript, setTranscript] = createSignal<string[]>([]);
  // The mock host records prompts; surface them like a transcript would.
  const originalSend = context.host.sendToAgent;
  context.host.sendToAgent = (markdown) => {
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
              the linked pull request lands with the button.
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
            {transcript().map((line) => (
              <pre class="rounded-lg bg-surface-1 p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted">
                {line}
              </pre>
            ))}
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
