import {
  type AgentActivityData,
  isAgentActivityCard,
} from '@macro-inc/lexical-core';
import { Key } from '@solid-primitives/keyed';
import { Show } from 'solid-js';
import { ActivityRows, type ActivityRowView } from './components/activity-rows';
import { PresentedView } from './components/presented-view';
import { replyToTurn, segmentRows } from './core/live-reply';
import { createCodeActivityRows } from './queries/code-activity';
import { createLiveSession } from './queries/live-session';

/**
 * The steps of an agent's reply inside a channel message.
 *
 * Live while the run of steps is still open, from the session's own fold, so
 * a step ticks from running to done where it was posted. Once the run seals,
 * or for a viewer who cannot read the session, the snapshot the server wrote
 * into the message keeps the status and label. Raw commands and tool-input
 * details are available only in the authorized live session view.
 */
export function AgentActivity(props: AgentActivityData) {
  return (
    <div class="min-w-0 max-w-full" data-agent-activity={props.agentSessionId}>
      <Show when={!props.sealed} fallback={<Run rows={props.rows} />}>
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
  return <Run rows={activity()} />;
}

/**
 * A run's steps, then the views it presented. A view is the answer, so it
 * stands in for the step that presented it and never folds behind the
 * earlier steps.
 */
function Run(props: { rows: readonly ActivityRowView[] }) {
  const steps = () =>
    props.rows.filter((row) => !isAgentActivityCard(row.card));
  const views = () =>
    props.rows.flatMap((row) =>
      isAgentActivityCard(row.card) ? [{ id: row.id, view: row.card.view }] : []
    );
  return (
    <>
      <Show when={steps().length > 0}>
        <ActivityRows rows={steps()} />
      </Show>
      <Key each={views()} by="id">
        {(presented) => <PresentedView view={presented().view} />}
      </Key>
    </>
  );
}
