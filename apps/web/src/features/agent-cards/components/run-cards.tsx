import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { Key } from '@solid-primitives/keyed';
import { lazy, Match, Show, Suspense, Switch } from 'solid-js';
import type { RunCard } from '../core/run-cards';
import { DataCard } from './data-card';

// Its drafts open in the email and calendar composers: loaded only when a
// run saved some.
const ReviewCard = lazy(async () => ({
  default: (await import('./review-card')).ReviewCard,
}));

const asView = (card: RunCard) => (card.kind === 'view' ? card : undefined);
const asData = (card: RunCard) => (card.kind === 'data' ? card : undefined);
const asReview = (card: RunCard) => (card.kind === 'review' ? card : undefined);

/**
 * What the agent chose to show: the views it composed for the user, the
 * database answers it asked to show, and drafts it saved for the user to
 * review. An agent's reply in a channel shows them where the steps that
 * showed them ran. Loaded on its own, so a conversation without cards never
 * loads what they render with.
 *
 * Cards are kept by key: a live run works its cards out again on every
 * paint, and a card that is still there must stay mounted - its entrance
 * plays once, its data stays subscribed, and a list it opened stays open.
 */
export default function RunCards(props: {
  cards: readonly RunCard[];
  /** The session the run is in; drafts saved for review live there. */
  sessionId?: string;
}) {
  return (
    <div class="my-1.5 flex min-w-0 flex-col gap-2">
      <Key each={props.cards} by="key">
        {(entry) => (
          <Switch>
            <Match when={asView(entry())}>
              {(view) => <AgentView view={view().view} />}
            </Match>
            <Match when={asData(entry())}>
              {(data) => (
                <DataCard
                  sql={data().sql}
                  databaseId={data().databaseId}
                  display={data().display}
                />
              )}
            </Match>
            <Match when={asReview(entry())}>
              {(review) => (
                <Show when={props.sessionId}>
                  {(sessionId) => (
                    <Suspense
                      fallback={
                        <div class="skeleton-shimmer h-16 w-full max-w-xl rounded-xl bg-skeleton" />
                      }
                    >
                      <ReviewCard
                        sessionId={sessionId()}
                        reviewId={review().reviewId}
                        drafts={review().drafts}
                      />
                    </Suspense>
                  )}
                </Show>
              )}
            </Match>
          </Switch>
        )}
      </Key>
    </div>
  );
}

/**
 * A view the agent composed for the user. Its widgets are cards and prose
 * in their own right, so the view itself is not boxed: a box around cards
 * would put cards in a card.
 */
function AgentView(props: { view: unknown }) {
  return (
    <div
      class="w-full max-w-2xl min-w-0 transition-opacity duration-300 starting:opacity-0"
      data-agent-view
    >
      <Suspense
        fallback={<div class="skeleton-shimmer h-16 rounded-xl bg-skeleton" />}
      >
        <DashboardToolView view={props.view} pending={false} />
      </Suspense>
    </div>
  );
}
