import { ItemCard } from '@app/features/agent-cards/components/item-card';
import { DashboardToolView } from '@app/features/dynamic-ui/DashboardToolView.lazy';
import { createMemo, For, Match, Suspense, Switch } from 'solid-js';
import { runCards } from '../core/cards';

/**
 * What a run of steps produced, after its rows: the items the agent created,
 * changed or sent, and the views it composed for the user. Loaded on its
 * own, so a conversation without cards never loads what they render with.
 */
export default function ActivityCards(props: {
  rows: readonly { id: string; card?: unknown }[];
}) {
  const cards = createMemo(() => runCards(props.rows));
  return (
    <div class="mt-1.5 mb-1 flex min-w-0 flex-col gap-2">
      <For each={cards()}>
        {(card) => (
          <Switch>
            <Match when={card.kind === 'item' && card}>
              {(item) => (
                <ItemCard
                  item={item().item}
                  action={item().action}
                  title={item().title}
                />
              )}
            </Match>
            <Match when={card.kind === 'view' && card}>
              {(view) => <ViewCard view={view().view} />}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}

/** A view the agent composed, framed as something it is showing you. */
function ViewCard(props: { view: unknown }) {
  return (
    <div
      class="w-full max-w-2xl min-w-0 rounded-xl border border-edge-muted bg-panel p-3 transition-opacity duration-300 starting:opacity-0"
      data-agent-view
    >
      <Suspense
        fallback={<div class="h-16 animate-pulse rounded-lg bg-hover" />}
      >
        <DashboardToolView view={props.view} pending={false} />
      </Suspense>
    </div>
  );
}
