import { openAgentComposer } from '@app/features/agents-view/primitives/open-composer';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import type { MacrodStatus } from '@macro/tauri/macrod';
import type { ReadyAgent } from './core/setup';
import { useSetupCapabilities } from './queries/setup-capabilities';
import { LocalRuntimeSetupPanel } from './views/local-runtime-setup-panel';

/**
 * The setup panel with production capabilities: the Tauri bridge, the agent
 * queries, and the Agents composer for the first session.
 */
export function LocalRuntimeSetup(props: {
  defaultWorkspace?: string;
  running?: MacrodStatus;
  autoStart?: boolean;
  onClose?: () => void;
}) {
  const capabilities = useSetupCapabilities();
  const userId = useUserId();
  const layout = useSplitLayout();

  const openSession = (agent: ReadyAgent) => {
    // The composer opens in Auto, with this agent as the usual coding agent.
    createRecentAgentSelections(userId()).remember(agent.botId);
    openAgentComposer(layout);
  };

  return (
    <LocalRuntimeSetupPanel
      capabilities={capabilities}
      onOpenSession={openSession}
      defaultWorkspace={props.defaultWorkspace}
      running={props.running}
      autoStart={props.autoStart}
      onClose={props.onClose}
    />
  );
}
