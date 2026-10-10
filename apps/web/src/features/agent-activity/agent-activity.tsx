import type { AgentActivityData } from '@macro-inc/lexical-core';
import { isAgentActivityCard } from '@macro-inc/lexical-core';
import { lazy, Show, Suspense } from 'solid-js';
import { ActivityRows, type ActivityRowView } from './components/activity-rows';
import { isViewCard } from './core/cards';
import { replyToTurn, segmentRows } from './core/live-reply';
import { createLiveSession } from './queries/live-session';

const ActivityCards = lazy(() => import('./components/activity-cards'));

/**
 * The steps of an agent's reply inside a channel message, and what they
 * produced.
 *
 * Live while the run of steps is still open, from the session's own fold, so
 * a step ticks from running to done where it was posted and its card
 * appears as soon as it finishes. Once the run seals, or for a viewer who
 * cannot read the session, the snapshot the server wrote into the message
 * is the whole story - the same rows and cards, worded the same way.
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
  const rows = () => {
    const reply = replyToTurn(live.messages(), props.turn);
    return (reply && segmentRows(reply, props.segment)) ?? props.rows;
  };
  return <Run rows={rows()} />;
}

/**
 * A run's steps, then its cards. A view the agent composed replaces its
 * own step: showing it is the step.
 */
function Run(props: {
  rows: readonly (ActivityRowView & { card?: unknown })[];
}) {
  const steps = () => props.rows.filter((row) => !isViewCard(row.card));
  const carded = () => props.rows.some((row) => isAgentActivityCard(row.card));
  return (
    <>
      <Show when={steps().length > 0}>
        <ActivityRows rows={steps()} />
      </Show>
      <Show when={carded()}>
        <Suspense>
          <ActivityCards rows={props.rows} />
        </Suspense>
      </Show>
    </>
  );
}
