import PhoneIcon from '@phosphor/phone.svg';
import { Avatar, Button, Tooltip } from '@ui';
import { MEETING_INVITATION_RING_MS } from '../core/meeting-invitations';

/** A visible invitation that never steals focus from the recipient's work. */
export function IncomingCallNotification(props: {
  title: string;
  callerName: string;
  remainingMs: number;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const title = () => props.title || 'Quick Call';
  const remainingSeconds = () => Math.ceil(props.remainingMs / 1000);
  const initials = () =>
    props.callerName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';

  return (
    <section
      aria-label={`Incoming call: ${title()}`}
      class="pointer-events-auto relative overflow-hidden rounded-xl border border-edge-muted bg-menu p-4 text-ink glass [--color-surface:var(--color-menu)]"
    >
      <div
        role="progressbar"
        aria-label="Time until incoming call dismisses"
        aria-valuemin={0}
        aria-valuemax={MEETING_INVITATION_RING_MS / 1000}
        aria-valuenow={remainingSeconds()}
        aria-valuetext={`${remainingSeconds()} seconds remaining`}
        class="absolute inset-x-0 top-0 h-1 overflow-hidden bg-accent-bg"
      >
        <div
          class="h-full origin-left bg-accent transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{
            transform: `scaleX(${props.remainingMs / MEETING_INVITATION_RING_MS})`,
          }}
        />
      </div>
      <div class="flex items-center gap-3">
        <Avatar
          size="lg"
          class="size-12 bg-accent-bg text-accent ring-2 ring-accent/40 ring-offset-2 ring-offset-menu"
        >
          <Avatar.Fallback class="text-lg font-semibold">
            {initials()}
          </Avatar.Fallback>
        </Avatar>
        <div class="min-w-0 flex-1" role="status">
          <div class="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
            Incoming call
            <span aria-hidden="true" class="tabular-nums text-ink-muted">
              0:{String(remainingSeconds()).padStart(2, '0')}
            </span>
          </div>
          <Tooltip label={title()} class="block">
            <h2 class="truncate text-base font-semibold">{title()}</h2>
          </Tooltip>
          <Tooltip label={`${props.callerName} is calling you`} class="block">
            <p class="truncate text-sm text-ink-muted">
              {props.callerName} is calling you
            </p>
          </Tooltip>
        </div>
      </div>
      <div class="mt-4 flex gap-2">
        <Button
          variant="danger"
          size="lg"
          class="flex-1"
          aria-label={`Decline ${title()} call`}
          onClick={props.onDecline}
        >
          Decline
        </Button>
        <Button
          variant="success"
          size="lg"
          class="flex-1"
          aria-label={`Join ${title()} call`}
          onClick={props.onJoin}
        >
          <PhoneIcon aria-hidden="true" class="size-4" />
          Join
        </Button>
      </div>
    </section>
  );
}
