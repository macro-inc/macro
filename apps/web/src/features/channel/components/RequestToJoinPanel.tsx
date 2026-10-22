import { formatDate } from '@core/util/date';
import { Button } from '@ui';
import { Match, Switch } from 'solid-js';
import type { RequestToJoinView } from '../core/access-request';

/** Ask to join a channel, or follow up on an earlier request. */
export function RequestToJoinPanel(props: {
  view: RequestToJoinView;
  busy: boolean;
  onAsk: () => void;
  onWithdraw: () => void;
}) {
  return (
    <div class="mt-6 flex flex-col items-center gap-3 text-sm text-ink-muted">
      <Switch>
        <Match when={props.view.kind === 'ask'}>
          <p>Members of this channel will be asked to let you in.</p>
          <Button
            variant="cta"
            size="sm"
            disabled={props.busy}
            onClick={props.onAsk}
          >
            Ask to join
          </Button>
        </Match>
        <Match when={props.view.kind === 'pending'}>
          <p>
            Request sent. You'll get access as soon as a channel member approves
            it.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.busy}
            onClick={props.onWithdraw}
          >
            Withdraw request
          </Button>
        </Match>
        <Match when={props.view.kind === 'denied' ? props.view : undefined}>
          {(view) => (
            <p>
              Your request was denied. You can ask again after{' '}
              {formatDate(view().retryAfter, { showTime: true })}.
            </p>
          )}
        </Match>
        <Match when={props.view.kind === 'wait' ? props.view : undefined}>
          {(view) => (
            <>
              <p>
                You can ask again after{' '}
                {formatDate(view().retryAfter, { showTime: true })}.
              </p>
              <Button variant="cta" size="sm" disabled>
                Ask to join
              </Button>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
