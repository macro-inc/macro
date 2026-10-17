import { runCards } from '@app/features/agent-cards/core/run-cards';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { createMemo, lazy, Show, Suspense } from 'solid-js';

const RunCards = lazy(
  () => import('@app/features/agent-cards/components/run-cards')
);

/**
 * What a run of tool calls produced, under the run: the items it created,
 * changed or sent, the database answers it showed, and what its searches
 * found - the cards the same reply carries in a channel. They stay when the
 * run is folded: they are what the work was for.
 *
 * The fold words each call as a step and attaches its card once the call
 * has finished, so a card appears as soon as its call does. A composed view
 * and drafts saved for review are not among them here: the session shows
 * each where its call ran.
 */
export function ToolRunCards(props: {
  message: FoldedMessage;
  /** The run's tool calls, by id, in the order they ran. */
  calls: readonly string[];
}) {
  const cards = createMemo(() => {
    const steps = new Map(
      props.message.segments
        .flatMap((segment) => segment.rows)
        .map((row) => [row.id, row])
    );
    const rows = props.calls.flatMap((id) => steps.get(id) ?? []);
    return runCards(rows).filter(
      (card) => card.kind !== 'view' && card.kind !== 'review'
    );
  });
  return (
    <Show when={cards().length > 0}>
      <Suspense>
        <RunCards cards={cards()} />
      </Suspense>
    </Show>
  );
}
