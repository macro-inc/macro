import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { For } from 'solid-js';
import { match } from 'ts-pattern';
import type { InboxDecision, InboxRowAction } from '../core/inbox-row';

const actionLabel = (action: InboxRowAction) =>
  match(action.kind)
    .with('open', () => t('notificationsInbox.actionOpen'))
    .with('answer', () => t('notificationsInbox.actionAnswer'))
    .with('review', () => t('notificationsInbox.actionReview'))
    .with('approve', () => t('notificationsInbox.actionApprove'))
    .with('deny', () => t('notificationsInbox.actionDeny'))
    .with('accept', () => t('notificationsInbox.actionAccept'))
    .with('decline', () => t('notificationsInbox.actionDecline'))
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
          variant={index() === 0 ? 'primary' : 'secondary'}
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
