import { formatDate, formatEmailDate } from '@core/util/date';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { Button } from '@ui';
import { Match, Switch } from 'solid-js';

/** What participants can see and do about a request to join. */
export type AccessRequestOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'pending'; canAnswer: boolean }
  | { kind: 'approved'; by: string }
  | { kind: 'denied'; by: string }
  | { kind: 'withdrawn' };

/** A request to join, announced in the channel with inline answers. */
export function AccessRequestActivityRow(props: {
  eventId: string;
  occurredAt: string;
  requesterName: string;
  outcome: AccessRequestOutcome;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div
      class="flex gap-2 py-1.5 pl-(--message-padding-x) pr-2 text-sm text-ink-muted"
      data-system-activity={props.eventId}
    >
      <span
        class="w-(--user-icon-width) h-6 shrink-0 flex items-center justify-center"
        aria-hidden="true"
      >
        <UserPlusIcon class="size-4.5 text-accent" />
      </span>
      <div class="min-w-0 flex-1 flex flex-col gap-1.5">
        <div class="min-h-6 flex items-center gap-2">
          <span class="min-w-0 truncate">
            <span class="font-medium text-ink">{props.requesterName}</span>{' '}
            asked to join the channel
          </span>
          <time
            class="shrink-0 text-xs text-ink-extra-muted"
            dateTime={props.occurredAt}
            title={formatEmailDate(props.occurredAt)}
          >
            {formatDate(props.occurredAt, { showTime: true })}
          </time>
        </div>
        <Switch>
          <Match
            when={props.outcome.kind === 'pending' && props.outcome.canAnswer}
          >
            <div class="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={props.busy}
                onClick={props.onApprove}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={props.busy}
                onClick={props.onDeny}
              >
                Deny
              </Button>
            </div>
          </Match>
          <Match when={props.outcome.kind === 'pending'}>
            <span class="text-xs">Waiting for a channel member to answer</span>
          </Match>
          <Match
            when={props.outcome.kind === 'approved' ? props.outcome : undefined}
          >
            {(outcome) => (
              <span class="text-xs">
                Approved by{' '}
                <span class="font-medium text-ink">{outcome().by}</span>
              </span>
            )}
          </Match>
          <Match
            when={props.outcome.kind === 'denied' ? props.outcome : undefined}
          >
            {(outcome) => (
              <span class="text-xs">
                Denied by{' '}
                <span class="font-medium text-ink">{outcome().by}</span>
              </span>
            )}
          </Match>
          <Match when={props.outcome.kind === 'withdrawn'}>
            <span class="text-xs">Request withdrawn</span>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
