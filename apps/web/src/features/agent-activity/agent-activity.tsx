import type { AgentActivityData } from '@macro-inc/lexical-core';
import { Show } from 'solid-js';
import { ActivityLine } from './components/activity-line';
import { ActivitySummary } from './components/activity-summary';
import { replyToTurn, segmentRows } from './core/live-reply';
import { createCodeActivityRows } from './queries/code-activity';
import { createLiveSession } from './queries/live-session';

/**
 * The steps of an agent's reply inside a channel message.
 *
 * While the run of steps is open it is one shimmering line naming the step
 * the agent is on, live from the session's own fold. Once the run seals, or
 * for a viewer who cannot read the session, the snapshot the server wrote
 * into the message keeps the status and label; a sealed run folds to a
 * summary that opens to its steps. Raw commands and tool-input details are
 * available only in the authorized live session view.
 */
export function AgentActivity(props: AgentActivityData) {
  return (
    <div class="min-w-0 max-w-full" data-agent-activity={props.agentSessionId}>
      <Show
        when={!props.sealed}
        fallback={<ActivitySummary rows={props.rows} />}
      >
        <LiveActivity {...props} />
      </Show>
    </div>
  );
}

function LiveActivity(props: AgentActivityData) {
  const live = createLiveSession(() => props.agentSessionId);
  const reply = () => replyToTurn(live.messages(), props.turn);
  const rows = () => {
    const message = reply();
    return (message && segmentRows(message, props.segment)) ?? props.rows;
  };
  const activity = createCodeActivityRows(
    () => props.agentSessionId,
    reply,
    () => props.segment,
    rows
  );
  return <ActivityLine rows={activity()} />;
}
