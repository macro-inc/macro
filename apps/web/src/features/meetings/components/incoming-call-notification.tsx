import { t } from '@app/lib/i18n';
import PhoneIncomingIcon from '@icon/system/fill/phone-incoming-fill.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import PhoneDisconnectIcon from '@icon/system/regular/phone-disconnect.svg';
import { Button, Tooltip } from '@ui';
import type { JSX } from 'solid-js';

/**
 * One ringing call in the app-wide incoming call stack: who is calling, where,
 * and how long until the ring stops. It never takes focus from the
 * recipient's work.
 */
export function IncomingCallNotification(props: {
  /** The caller's picture, about 48px. */
  avatar: JSX.Element;
  callerName: string;
  /** Where the call is: "Calling you", "Calling in design". */
  detail: string;
  remainingMs: number;
  ringDurationMs: number;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const remainingSeconds = () => Math.ceil(props.remainingMs / 1000);

  return (
    <section
      aria-label={t('calls.incomingCallFrom', { name: props.callerName })}
      class="@container pointer-events-auto relative overflow-hidden rounded-2xl p-3 pt-4 shadow-menu menu-surface light-mode:composer-shadow motion-safe:animate-incoming-call-in"
    >
      <div
        role="progressbar"
        aria-label={t('calls.ringTimeRemaining')}
        aria-valuemin={0}
        aria-valuemax={props.ringDurationMs / 1000}
        aria-valuenow={remainingSeconds()}
        aria-valuetext={t('calls.ringSecondsRemaining', {
          count: remainingSeconds(),
        })}
        class="absolute inset-x-4 top-1.5 h-[3px] overflow-hidden rounded-full bg-accent-bg"
      >
        <div
          class="h-full origin-left rounded-full bg-accent transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{
            transform: `scaleX(${props.remainingMs / props.ringDurationMs})`,
          }}
        />
      </div>
      <div class="flex flex-col gap-3 @sm:flex-row @sm:items-center">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="flex size-12 shrink-0 items-center justify-center rounded-full ring-2 ring-accent/40 ring-offset-2 ring-offset-menu">
            {props.avatar}
          </div>
          <div class="min-w-0 flex-1" role="status">
            <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
              <PhoneIncomingIcon
                aria-hidden="true"
                class="incoming-call-shake size-3.5 shrink-0"
              />
              {t('calls.incomingCall')}
              <span aria-hidden="true" class="tabular-nums text-ink-muted">
                0:{String(remainingSeconds()).padStart(2, '0')}
              </span>
            </div>
            <Tooltip label={props.callerName} class="block">
              <h2 class="truncate text-base font-semibold text-ink">
                {props.callerName}
              </h2>
            </Tooltip>
            <Tooltip label={props.detail} class="block">
              <p class="truncate text-sm text-ink-muted">{props.detail}</p>
            </Tooltip>
          </div>
        </div>
        <div class="grid shrink-0 grid-cols-2 gap-2">
          <Button
            variant="danger"
            size="md"
            aria-label={t('calls.declineCallFrom', { name: props.callerName })}
            onClick={props.onDecline}
          >
            <PhoneDisconnectIcon aria-hidden="true" class="size-4" />
            {t('calls.decline')}
          </Button>
          <Button
            variant="success"
            size="md"
            aria-label={t('calls.joinCallFrom', { name: props.callerName })}
            onClick={props.onJoin}
          >
            <PhoneIcon aria-hidden="true" class="size-4" />
            {t('calls.join')}
          </Button>
        </div>
      </div>
    </section>
  );
}
