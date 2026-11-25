import type { Span } from '@macro-inc/observability';
import { match } from 'ts-pattern';
import type { ScreenClientEndReason, ScreenEndReason } from './types';

type Stage =
  | 'ticket'
  | 'ticket_issued'
  | 'socket_upgrade'
  | 'browser_handshake'
  | 'first_frame';
type CloseReason =
  | 'ready'
  | 'canceled'
  | 'ticket_failed'
  | 'socket_error'
  | 'parser_error'
  | 'timeout'
  | 'shutdown'
  | 'computer_off'
  | 'access_revoked'
  | 'idle'
  | 'relay_error'
  | 'eof';

export function viewerCloseReason(
  reason: ScreenEndReason | ScreenClientEndReason
) {
  return match(reason)
    .returnType<CloseReason>()
    .with('stopped', () => 'canceled')
    .with('computerOff', () => 'computer_off')
    .with('accessRevoked', () => 'access_revoked')
    .with('shutdown', () => 'shutdown')
    .with('idle', () => 'idle')
    .with('error', () => 'relay_error')
    .with('connectionLost', () => 'eof')
    .exhaustive();
}

export type ViewerAttempt = ReturnType<typeof viewerAttempt>;

/** One terminal summary, while the connection span can continue past the first frame. */
export function viewerAttempt(span: Span, journey: string, number: number) {
  let stage: Stage = 'ticket';
  let finished = false;
  let received = 0;
  let sent = 0;
  // A silent guest can leave the socket open. Bound the telemetry wait
  // independently of the viewer's reconnect and wake behavior.
  const deadline = setTimeout(() => finish('timeout'), 90_000);
  span.setAttr('screen.journey.id', journey);
  span.setAttr('screen.attempt', number);
  span.setAttr('screen.role', 'viewer');

  function finish(reason: CloseReason) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    span.setAttr('screen.terminal_stage', stage);
    span.setAttr('screen.close_reason', reason);
    span.setAttr('screen.bytes_received', received);
    span.setAttr('screen.bytes_sent', sent);
    if (reason !== 'ready' && reason !== 'canceled') span.error(reason);
    span.end();
  }

  return {
    socketUrl(value: string) {
      const url = new URL(value);
      url.searchParams.set('journey', journey);
      url.searchParams.set('attempt', String(number));
      return url.toString();
    },
    milestone(next: Exclude<Stage, 'ticket'>) {
      if (finished) return;
      stage = next;
      span.event('computer.screen.viewer_milestone', { stage });
      if (stage === 'first_frame') finish('ready');
    },
    received(bytes: number) {
      if (!finished) received += bytes;
    },
    sent(bytes: number) {
      if (!finished) sent += bytes;
    },
    finish,
  };
}
