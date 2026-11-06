import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { Button } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { CallTeamShareChangeControl } from '../use-call-team-share-change';

/**
 * Where a call's team-sharing change stands, with this viewer's answer or
 * their way of withdrawing it.
 */
export function CallTeamShareChangeStatus(props: {
  change: Pick<
    CallTeamShareChangeControl,
    'pending' | 'awaitsMyAnswer' | 'isMine' | 'isAnswering'
  > & { answer: (approve: boolean) => unknown };
}) {
  const goal = () =>
    props.change.pending()?.shared
      ? 'share this call with the team'
      : 'make this call private';
  const waitingOn = () => props.change.pending()?.waitingOn ?? [];
  const waitingLabel = () => {
    const [first, ...rest] = waitingOn();
    if (!first) return 'Saving…';
    if (rest.length === 0)
      return `Waiting for ${getDisplayName(tryMacroId(first))} to approve`;
    return `Waiting for ${waitingOn().length} people to approve`;
  };
  const requester = () =>
    getDisplayName(tryMacroId(props.change.pending()?.requestedBy ?? ''));

  return (
    <Show when={props.change.pending()}>
      <div class="flex flex-col gap-2 px-2 py-1.5 text-xs text-ink-muted">
        <Switch>
          <Match when={props.change.awaitsMyAnswer()}>
            <span>
              {requester()} wants to {goal()}.
            </span>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={props.change.isAnswering()}
                onClick={() => props.change.answer(true)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={props.change.isAnswering()}
                onClick={() => props.change.answer(false)}
              >
                Decline
              </Button>
            </div>
          </Match>
          <Match when={props.change.isMine()}>
            <span>{waitingLabel()}</span>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={props.change.isAnswering()}
                onClick={() => props.change.answer(false)}
              >
                Cancel request
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <span>
              {requester()} asked to {goal()}. {waitingLabel()}.
            </span>
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
