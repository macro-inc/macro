import { t } from '@app/lib/i18n';
import { MAX_RING_DURATION_MS } from '@channel/Call/CallStartedNotifier';
import { UserIcon } from '@core/component/UserIcon';
import { Avatar } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { IncomingCallNotification } from '../components/incoming-call-notification';
import type { IncomingChannelCall } from '../core/incoming-channel-calls';
import { createRingCountdown } from '../primitives/invitation-countdown';

/** A ringing channel or DM call in the incoming call stack. */
export function IncomingChannelCallNotification(props: {
  call: IncomingChannelCall;
  concealed?: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const callerName = () => props.call.callerName || t('calls.someone');
  const detail = () =>
    match(props.call.place)
      .with({ kind: 'direct' }, () => t('calls.callingYou'))
      .with({ kind: 'channel' }, ({ name }) =>
        t('calls.callingInChannel', { channel: name })
      )
      .exhaustive();
  const remainingMs = createRingCountdown(
    () => props.call.expiresAt,
    MAX_RING_DURATION_MS
  );

  return (
    <IncomingCallNotification
      avatar={
        <Show
          when={props.call.callerId}
          fallback={
            <Avatar size="lg" class="size-12">
              <Avatar.Fallback class="font-semibold">?</Avatar.Fallback>
            </Avatar>
          }
        >
          {(callerId) => (
            <UserIcon
              id={callerId()}
              size="lg"
              class="size-12"
              suppressClick
              showTooltip={false}
            />
          )}
        </Show>
      }
      callerName={callerName()}
      detail={detail()}
      remainingMs={remainingMs()}
      ringDurationMs={MAX_RING_DURATION_MS}
      concealed={props.concealed}
      onJoin={props.onJoin}
      onDecline={props.onDecline}
    />
  );
}
