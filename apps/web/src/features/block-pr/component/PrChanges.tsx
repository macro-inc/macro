/**
 * The Changes pane on a pull request page: a read-only viewer over the pull
 * request's changes at its current base and head. Review state is kept under
 * `pr:<foreign-entity-id>`, apart from any agent session on the same pull
 * request. Hosts place `AgentChangesSplit` and `ChangesToggle` inside.
 */

import { copyText } from '@app/features/agent-changes/agent-changes';
import type { ChangesHost } from '@app/features/agent-changes/context/agent-changes-context';
import { AgentChangesControllerProvider } from '@app/features/agent-changes/context/agent-changes-controller';
import { createPaneViewState } from '@app/features/agent-changes/pane-view-state';
import { createAgentChanges } from '@app/features/agent-changes/primitives/create-agent-changes';
import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import { createSignal, type ParentProps } from 'solid-js';
import { createPrChangesSource } from '../data/pr-changes';

export function PrChangesProvider(
  props: ParentProps<{ foreignEntityId: string; pullRequestUrl?: string }>
) {
  const scopeKey = () => `pr:${props.foreignEntityId}`;
  const source = createPrChangesSource(() => props.foreignEntityId);
  const host: ChangesHost = {
    scopeKey,
    pullRequestUrl: () => props.pullRequestUrl,
    openExternal: openExternalUrl,
    copyText,
    notify: (message, tone) => {
      if (tone === 'success') toast.success(message);
      else toast.failure(message);
    },
  };
  const view = createPaneViewState();
  const [dismissed, setDismissed] = createSignal<string>();
  const controller = createAgentChanges({
    context: { source, host },
    view,
    dismissed: [dismissed, (id) => setDismissed(id)],
  });
  return (
    <AgentChangesControllerProvider value={controller}>
      {props.children}
    </AgentChangesControllerProvider>
  );
}
