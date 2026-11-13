import { formatDate, formatEmailDate } from '@core/util/date';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { Button, Tooltip } from '@ui';
import { Match, Show, Switch } from 'solid-js';

/** What participants can see and do about a request to join. */
export type AccessRequestOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'pending'; canAnswer: boolean }
  | { kind: 'approved'; by: string }
  | { kind: 'denied'; by: string }
  | { kind: 'withdrawn' };

/**
 * A request to join, announced in the channel with inline answers.
 *
 * The channel list measures a row once when it mounts, so the row's height
 * never depends on what loads later. The request wraps like message text from
 * what is known at mount (the name stored with the event, or the email), and
 * the answer line keeps the buttons' height in every state (taller on touch,
 * like them), including while the request loads.
 */
export function AccessRequestActivityRow(props: {
  eventId: string;
  occurredAt: string;
  requesterName: string;
  requesterEmail: string | undefined;
  outcome: AccessRequestOutcome;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const email = () =>
    props.requesterEmail && props.requesterEmail !== props.requesterName
      ? props.requesterEmail
      : undefined;
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
        <div class="flex items-start gap-2 leading-6">
          <p class="min-w-0 flex-1 wrap-break-word">
            <span class="font-medium text-ink">{props.requesterName}</span>{' '}
            <Show when={email()}>{(email) => <span>({email()}) </span>}</Show>
            asked to join the channel
          </p>
          <time
            class="shrink-0 text-xs/6 text-ink-extra-muted"
            dateTime={props.occurredAt}
            title={formatEmailDate(props.occurredAt)}
          >
            {formatDate(props.occurredAt, { showTime: true })}
          </time>
        </div>
        <div class="h-7 touch:h-9 flex items-center gap-2 text-xs">
          <Switch>
            <Match
              when={props.outcome.kind === 'pending' && props.outcome.canAnswer}
            >
              <Button
                size="sm"
                variant="primary"
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
            </Match>
            <Match when={props.outcome.kind === 'pending'}>
              <span class="truncate">
                Waiting for a channel member to answer
              </span>
            </Match>
            <Match
              when={
                props.outcome.kind === 'approved' ? props.outcome : undefined
              }
            >
              {(outcome) => (
                <Tooltip
                  label={`Approved by ${outcome().by}`}
                  class="min-w-0 max-w-max truncate"
                  as="span"
                >
                  <span class="truncate">
                    Approved by{' '}
                    <span class="font-medium text-ink">{outcome().by}</span>
                  </span>
                </Tooltip>
              )}
            </Match>
            <Match
              when={props.outcome.kind === 'denied' ? props.outcome : undefined}
            >
              {(outcome) => (
                <Tooltip
                  label={`Denied by ${outcome().by}`}
                  class="min-w-0 max-w-max truncate"
                  as="span"
                >
                  <span class="truncate">
                    Denied by{' '}
                    <span class="font-medium text-ink">{outcome().by}</span>
                  </span>
                </Tooltip>
              )}
            </Match>
            <Match when={props.outcome.kind === 'withdrawn'}>
              <span class="truncate">Request withdrawn</span>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
