import { t } from '@app/lib/i18n';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ControlLost } from '../core/screen-status';

/**
 * Says that this viewer's drive ended without it letting go (its connection
 * dropped, the lease lapsed, someone took over), and, once it's known to be
 * gone, offers to take over again. Never shown when the server kept the
 * lease across a reconnect.
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
      .with({ kind: 'released', driver: null, reconnected: true }, () =>
        t('agentScreen.controlLostReleased')
      )
      .with({ kind: 'released', driver: null, reconnected: false }, () =>
        t('agentScreen.controlLostLapsed')
      )
      .with({ kind: 'released', reconnected: true }, ({ driver }) =>
        t('agentScreen.controlLostTakenBy', {
          name:
            props.driverName ?? driver?.name ?? t('agentScreen.someoneElse'),
        })
      )
      .with({ kind: 'released', reconnected: false }, ({ driver }) =>
        t('agentScreen.controlTakenBy', {
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
