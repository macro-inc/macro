import { ActivityLine } from '@app/features/block-agent/ui';
import { useSessionActivity } from '@core/agent-session/session-activity';
import {
  type AgentActivityData,
  isAgentActivityCard,
} from '@macro-inc/lexical-core';
import { Key } from '@solid-primitives/keyed';
import { Show } from 'solid-js';
import type { ActivityRowView } from './components/activity-rows';
import { ActivitySummary } from './components/activity-summary';
import { PresentedView } from './components/presented-view';
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
      <Show when={!props.sealed} fallback={<Run rows={props.rows} sealed />}>
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
  const summary = useSessionActivity(() => props.agentSessionId);
  return <Run rows={activity()} sealed={false} summary={summary()} />;
}

/**
 * A run's steps, then the views it presented. A view is the answer, so it
 * stands in for the step that presented it and never folds into the run's
 * line or summary.
 */
function Run(props: {
  rows: readonly ActivityRowView[];
  sealed: boolean;
  /** The session's live status line over an open run's steps. */
  summary?: string;
}) {
  const steps = () =>
    props.rows.filter((row) => !isAgentActivityCard(row.card));
  const views = () =>
    props.rows.flatMap((row) =>
      isAgentActivityCard(row.card) ? [{ id: row.id, view: row.card.view }] : []
    );
  return (
    <>
      <Show when={steps().length > 0}>
        <Show
          when={props.sealed}
          fallback={<ActivityLine steps={steps()} summary={props.summary} />}
        >
          <ActivitySummary rows={steps()} />
        </Show>
      </Show>
      <Key each={views()} by="id">
        {(presented) => <PresentedView view={presented().view} />}
      </Key>
    </>
  );
}

const THINKING: ActivityRowView = {
  id: 'thinking',
  label: 'Thinking',
  status: 'running',
};

/**
 * A reply whose turn is running with no open run to show: the line a run
 * uses, so the reply never reads as finished while the agent works.
 */
export function AgentThinking() {
  return <ActivityLine steps={[THINKING]} />;
}
