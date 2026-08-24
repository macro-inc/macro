/**
 * The session's status as a quiet dot + label pill. Pure: the status shape
 * mirrors the wire's `SessionStatusDto`.
 */

import { match } from 'ts-pattern';

export type SessionStatusLike =
  | { kind: 'no_messages' }
  | { kind: 'event'; event: string }
  | { kind: 'disconnected' };

export type SessionStatusPresentation = {
  label: string;
  tone: 'positive' | 'neutral' | 'negative';
};

/** `worktree_ready` → `Worktree ready`. */
function prettyEventName(event: string): string {
  const words = event.split(/[_-]/).filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The status dot + label a session status renders as, shared by the session
 * block's pill and the unified list's status column. */
export function sessionStatusPresentation(
  status: SessionStatusLike
): SessionStatusPresentation {
  return presentation(status);
}

function presentation(status: SessionStatusLike): SessionStatusPresentation {
  return match(status)
    .with({ kind: 'no_messages' }, (): SessionStatusPresentation => {
      return { label: 'Starting', tone: 'neutral' };
    })
    .with({ kind: 'disconnected' }, (): SessionStatusPresentation => {
      return { label: 'Disconnected', tone: 'negative' };
    })
    .with({ kind: 'event' }, (status): SessionStatusPresentation => {
      if (status.event === 'acp_ready') {
        return { label: 'Ready', tone: 'positive' };
      }
      if (status.event === 'disconnected') {
        return { label: 'Disconnected', tone: 'negative' };
      }
      // An event name the protocol doesn't model yet — show it rather than
      // hide it.
      return { label: prettyEventName(status.event), tone: 'neutral' };
    })
    .exhaustive();
}

export function SessionStatusPill(props: { status: SessionStatusLike }) {
  const current = () => presentation(props.status);

  return (
    <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-edge-muted px-2 py-0.5 text-xs text-ink-muted">
      <span
        aria-hidden="true"
        class="size-1.5 rounded-full"
        classList={{
          'bg-success': current().tone === 'positive',
          'bg-ink-placeholder': current().tone === 'neutral',
          'bg-failure': current().tone === 'negative',
        }}
      />
      {current().label}
    </span>
  );
}
