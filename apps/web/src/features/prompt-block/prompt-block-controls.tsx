import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { enableComposerAutoMode } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { chooseAgentMode } from '@queries/agents/mode-choice';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import {
  type PromptBlockContext,
  PromptBlockContextProvider,
} from './context/prompt-block-context';
import { PromptBlockControlsView } from './views/prompt-block-controls-view';

/** A prompt block's agent picker and Run button, wired to the app. */
export default function PromptBlockControls(props: { prompt: () => string }) {
  const userId = useUserId();
  const roster = createAgentRosterSource();
  const recentAgents = createRecentAgentSelections(userId());
  const autoMode = useFeatureFlag(enableComposerAutoMode);
  const context: PromptBlockContext = {
    accountId: userId,
    roster: roster.roster,
    recentAgentIds: recentAgents.ids,
    autoAvailable: () => autoMode().enabled,
    chooseMode: chooseAgentMode,
    start: (run) => {
      const id = startPendingSession({
        ...run,
        userId: userId(),
        submitSurface: 'prompt_block',
      });
      globalSplitManager()?.openWithSplit(
        { type: 'agent', id },
        { preferNewSplit: true }
      );
    },
  };
  return (
    <PromptBlockContextProvider value={context}>
      <PromptBlockControlsView prompt={props.prompt} />
    </PromptBlockContextProvider>
  );
}
