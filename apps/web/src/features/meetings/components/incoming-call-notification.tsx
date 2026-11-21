import { t } from '@app/lib/i18n';
import PhoneIcon from '@icon/system/regular/phone.svg';
import PhoneDisconnectIcon from '@icon/system/regular/phone-disconnect.svg';
import { Button, cn, Tooltip } from '@ui';
import type { JSX } from 'solid-js';

/**
 * One ringing call in the app-wide incoming call stack: who is calling and
 * where, with the time left to answer as a bar along the card's top edge. It
 * never takes focus from the recipient's work.
 */
export function IncomingCallNotification(props: {
  /** The caller's picture, about 48px. */
  avatar: JSX.Element;
  callerName: string;
  /** Where the call is: "Calling you", "Calling you in #design". */
  detail: string;
  remainingMs: number;
  ringDurationMs: number;
  /**
   * Tucked under the newest call in a collapsed stack: the card shows as a
   * blank sheet peeking out, and its controls are out of reach.
   */
  concealed?: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const remainingSeconds = () => Math.ceil(props.remainingMs / 1000);

  return (
    <section
      aria-label={t('calls.incomingCallFrom', { name: props.callerName })}
      aria-hidden={props.concealed || undefined}
      inert={props.concealed}
      class="@container pointer-events-auto relative overflow-hidden rounded-2xl menu-surface motion-safe:animate-incoming-call-in"
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
        class="absolute inset-x-0 top-0 h-[3px] bg-accent-bg"
      >
        <div
          class="h-full origin-left bg-accent transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{
            transform: `scaleX(${props.remainingMs / props.ringDurationMs})`,
          }}
        />
      </div>
      <div
        class={cn(
          'flex flex-col gap-3 p-4 transition-opacity duration-200 motion-reduce:transition-none @sm:flex-row @sm:items-center',
          props.concealed && 'opacity-0'
        )}
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="flex size-12 shrink-0 items-center justify-center rounded-full">
            {props.avatar}
          </div>
          <div class="min-w-0 flex-1">
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
