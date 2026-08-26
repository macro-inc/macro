/**
 * The agents view's launcher: a chat composer that starts a new agent
 * session from a prompt.
 *
 * Reuses the agent block's own input (`AgentInput`) and its pending-session
 * flow: the prompt rides the `POST /agent-sessions` request as the session's
 * first turn, and the block opens immediately against a placeholder id
 * rather than waiting minutes for the sandbox to boot. The new session's row
 * joins the Running section below once the create lands and the list
 * refetches.
 */

import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { AgentInput } from '@app/features/block-agent/ui/AgentInput';
import { useSplitLayout } from '@components/app/split-layout/layout';

export function AgentLaunchHero() {
  const { openWithSplit } = useSplitLayout();

  const launch = (markdown: string) => {
    openWithSplit(
      { type: 'agent', id: startPendingSession({ prompt: markdown }) },
      { referredFrom: 'agents' }
    );
  };

  return (
    <div class="shrink-0 flex justify-center px-4 pt-[clamp(2.5rem,14vh,9rem)] pb-10 touch:pt-8 touch:pb-6">
      <div class="w-full max-w-xl flex flex-col gap-4">
        <h2 class="text-center text-lg font-medium text-ink">
          What should an agent work on?
        </h2>
        <AgentInput
          placeholder="Describe a task to start a new agent session"
          onSend={launch}
        />
        <p class="text-center text-xs text-ink-muted">
          Each prompt starts a fresh session — it opens beside this list and
          keeps running when you close it.
        </p>
      </div>
    </div>
  );
}
