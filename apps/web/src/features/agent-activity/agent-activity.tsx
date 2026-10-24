import {
  ItemFacts,
  refreshChangedItems,
} from '@app/features/agent-cards/core/item-facts';
import {
  itemFacts,
  type RunCard,
  replacesStep,
  runCards,
  runDuration,
  stepItem,
} from '@app/features/agent-cards/core/run-cards';
import { useOptionalMessage } from '@app/features/channel/Message/context';
import type { AgentActivityData } from '@macro-inc/lexical-core';
import { createMemo, createSignal, lazy, Show, Suspense } from 'solid-js';
import {
  ActivityRows,
  type ActivityRowView,
  RunSummary,
} from './components/activity-rows';
import { replyToTurn, segmentRows } from './core/live-reply';
import { createCodeActivityRows } from './queries/code-activity';
import { createLiveSession } from './queries/live-session';

const RunCards = lazy(
  () => import('@app/features/agent-cards/components/run-cards')
);

/**
 * The steps of an agent's reply inside a channel message, and what the agent
 * showed with them.
 *
 * Live while the run of steps is still open, from the session's own fold, so
 * a step ticks from running to done where it was posted, and what it showed
 * appears as soon as it finishes. Once the run seals, or for a viewer who
 * cannot read the session, the snapshot the server wrote into the message
 * keeps each step's status and label, the item it touched, and what it
 * showed. Raw commands and tool-input details are available only in the
 * authorized live session view.
 */
export function AgentActivity(props: AgentActivityData) {
  return (
    <div class="min-w-0 max-w-full" data-agent-activity={props.agentSessionId}>
      <Show
        when={!props.sealed}
        fallback={
          <Run rows={props.rows} sealed sessionId={props.agentSessionId} />
        }
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
  return (
    <Run rows={activity()} sealed={false} sessionId={props.agentSessionId} />
  );
}

/**
 * A run's steps and what the agent showed with them. While it runs, each
 * step shows as it goes, a step that touched an item naming it on its line.
 * Once it is over, the steps fold into one line - how long it worked, and
 * for how many steps - and what the agent showed stays: it is the answer. A
 * run where a step failed stays open, so the failure is never folded away,
 * and a long open run keeps what the steps it folds behind a count showed
 * above that count. A view the agent composed replaces its own step:
 * showing it is the step, and a card in it for an item the run created or
 * changed says so.
 */
function Run(props: {
  rows: readonly (ActivityRowView & { card?: unknown })[];
  sealed: boolean;
  /** The session the run is in. */
  sessionId: string;
}) {
  const message = useOptionalMessage();
  const cards = createMemo(() => runCards(props.rows));
  const facts = createMemo(() => itemFacts(props.rows));
  refreshChangedItems(() => props.rows);
  const steps = () => props.rows.filter((row) => !replacesStep(row.card));
  const failed = () =>
    steps().some(
      (row) => row.status === 'failed' || row.status === 'interrupted'
    );
  const foldable = () => props.sealed && steps().length > 1 && !failed();
  const [open, setOpen] = createSignal(false);
  const duration = () => {
    const posted = message?.();
    return posted
      ? runDuration(posted.created_at, posted.updated_at)
      : undefined;
  };
  const cardsOf = (rowIds: readonly string[]) =>
    cards().filter((card) => rowIds.includes(card.rowId));

  return (
    <ItemFacts.Provider value={facts}>
      <Show
        when={foldable() && !open()}
        fallback={
          <>
            <Show when={foldable()}>
              <RunSummary
                steps={steps().length}
                duration={duration()}
                open
                onToggle={() => setOpen(false)}
              />
            </Show>
            <ActivityRows
              rows={props.rows}
              all={foldable()}
              inPlace={(row) => replacesStep(row.card)}
              item={(row) => stepItem(row.card)}
              after={(id) => (
                <Cards cards={cardsOf([id])} sessionId={props.sessionId} />
              )}
              earlier={(ids) => (
                <Cards cards={cardsOf(ids())} sessionId={props.sessionId} />
              )}
            />
          </>
        }
      >
        <RunSummary
          steps={steps().length}
          duration={duration()}
          open={false}
          onToggle={() => setOpen(true)}
        />
        <Cards cards={cards()} sessionId={props.sessionId} />
      </Show>
    </ItemFacts.Provider>
  );
}

/** What the agent showed, loaded only when a run showed anything. */
function Cards(props: { cards: readonly RunCard[]; sessionId: string }) {
  return (
    <Show when={props.cards.length > 0}>
      <Suspense>
        <RunCards cards={props.cards} sessionId={props.sessionId} />
      </Suspense>
    </Show>
  );
}
