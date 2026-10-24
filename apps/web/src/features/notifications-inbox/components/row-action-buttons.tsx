import { Button } from '@ui';
import { For } from 'solid-js';
import { match } from 'ts-pattern';
import type { InboxDecision, InboxRowAction } from '../core/inbox-row';

const actionLabel = (action: InboxRowAction) =>
  match(action.kind)
    .with('open', () => 'Open')
    .with('answer', () => 'Answer')
    .with('review', () => 'Review')
    .with('approve', () => 'Approve')
    .with('deny', () => 'Deny')
    .with('accept', () => 'Accept')
    .with('decline', () => 'Decline')
    .exhaustive();

/**
 * What the viewer can do from a notification, the primary action first.
 * While a decision is in flight every button is disabled and the chosen one
 * says so.
 */
export function RowActionButtons(props: {
  actions: readonly InboxRowAction[];
  pending: InboxDecision | undefined;
  onChoose: (action: InboxRowAction) => void;
}) {
  return (
    <For each={props.actions}>
      {(action, index) => (
        <Button
          size="sm"
          variant={index() === 0 ? 'cta' : 'outline'}
          disabled={props.pending !== undefined}
          aria-busy={props.pending === action.kind}
          onClick={(event) => {
            event.stopPropagation();
            props.onChoose(action);
          }}
        >
          {actionLabel(action)}
        </Button>
      )}
    </For>
  );
}
