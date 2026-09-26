import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import { createSignal, Suspense } from 'solid-js';
import type { ChangesHost } from '../agent-changes/context/agent-changes-context';
import { AgentChangesControllerProvider } from '../agent-changes/context/agent-changes-controller';
import type { DiffStyle, PaneLayout } from '../agent-changes/core/layout';
import { createAgentChanges } from '../agent-changes/primitives/create-agent-changes';
import { createPullRequestChangesSource } from '../agent-changes/queries/pull-request-changes';
import { ChangesPane } from '../agent-changes/views/ChangesPane';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** App wiring for the shared diff viewer, independent of any coding session. */
export function PrChanges(props: {
  foreignEntityId: string;
  pullRequestUrl: string;
  diffStyle: DiffStyle;
  onDiffStyleChange: (style: DiffStyle) => void;
}) {
  const source = createPullRequestChangesSource(() => props.pullRequestUrl);
  const host: ChangesHost = {
    scopeKey: () => `pr:${props.foreignEntityId}`,
    pullRequestUrl: () => props.pullRequestUrl,
    openExternal: openExternalUrl,
    copyText,
    notify: (message, tone) => {
      if (tone === 'success') toast.success(message);
      else toast.failure(message);
    },
  };
  const [layout, setLayout] = createSignal<PaneLayout>('changes-only');
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context: { source, host },
    paneLayout: [layout, setLayout],
    diffStyle: [() => props.diffStyle, props.onDiffStyleChange],
    dismissed: [dismissed, setDismissed],
  });

  return (
    <Suspense
      fallback={<div class="p-6 text-sm text-ink-muted">Loading changes…</div>}
    >
      <AgentChangesControllerProvider value={controller}>
        <ChangesPane />
      </AgentChangesControllerProvider>
    </Suspense>
  );
}
