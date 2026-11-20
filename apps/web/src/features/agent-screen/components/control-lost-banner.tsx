import { t } from '@app/lib/i18n';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ControlLost } from '../core/screen-status';

/**
 * Says that the connection dropped while this viewer was driving, and, once
 * back without the lease, offers to take over again. Never shown when the
 * server kept the lease across the reconnect.
 */
export function ControlLostBanner(props: {
  state: ControlLost | undefined;
  /** The current driver's display name, resolved from their user id. */
  driverName: string | undefined;
  /** Present when this viewer may drive. */
  onTakeOver: (() => void) | undefined;
  onDismiss: () => void;
}) {
  const message = (state: ControlLost) =>
    match(state)
      .with({ kind: 'reconnecting' }, () =>
        t('agentScreen.controlLostReconnecting')
      )
      .with({ kind: 'released', driver: null }, () =>
        t('agentScreen.controlLostReleased')
      )
      .with({ kind: 'released' }, ({ driver }) =>
        t('agentScreen.controlLostTakenBy', {
          name:
            props.driverName ?? driver?.name ?? t('agentScreen.someoneElse'),
        })
      )
      .exhaustive();

  return (
    <Show when={props.state}>
      {(state) => (
        <div
          role="status"
          class="flex items-center gap-2 rounded-lg border border-amber bg-panel px-3 py-2 text-sm text-ink"
        >
          <ArrowCounterClockwiseIcon class="size-4 shrink-0 text-amber-ink" />
          <span class="min-w-0 flex-1">{message(state())}</span>
          <Show when={state().kind === 'released' && props.onTakeOver}>
            {(takeOver) => (
              <Button size="sm" variant="primary" onClick={() => takeOver()()}>
                {t('agentScreen.takeOverAgain')}
              </Button>
            )}
          </Show>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('agentScreen.dismissControlLost')}
            tooltip={t('agentScreen.dismissControlLost')}
            onClick={() => props.onDismiss()}
          >
            <XIcon class="size-4" />
          </Button>
        </div>
      )}
    </Show>
  );
}
