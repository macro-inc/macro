import type { Span } from '@macro-inc/observability';

type Attempt = { span: Span; phase: Span };
type Session = { root: Span; attempt?: Attempt; retries: number };

/** Bounded connection phases share one session trace; credentials and URLs are never recorded. */
export function createSessionWebsocketTelemetry(
  name: 'connection-gateway' | 'storage',
  resolve: () => string | Promise<string>
) {
  let session: Session | undefined;

  function finishAttempt(current: Session, outcome: string, failed = false) {
    const attempt = current.attempt;
    if (!attempt) return;
    current.attempt = undefined;
    for (const span of [attempt.phase, attempt.span]) {
      span.setAttr('outcome', outcome);
      if (failed) span.error(`Session WebSocket ${outcome}`);
      span.end();
    }
  }

  return {
    activate(root: Span) {
      const current: Session = { root, retries: 0 };
      session = current;
      const activation = root.span('auth.session_socket.activate');
      activation.setAttr('ws.service', name);
      activation.setAttr('outcome', 'activated');
      activation.end();
      return () => {
        if (session !== current) return;
        session = undefined;
        finishAttempt(current, 'cancelled');
        const closing = root.span('auth.session_socket.close');
        closing.setAttr('ws.service', name);
        closing.setAttr('outcome', 'session-ended');
        closing.end();
      };
    },

    async resolveUrl(): Promise<string> {
      const current = session;
      if (!current) return resolve();
      finishAttempt(current, 'superseded');
      const span = current.root.span('auth.session_socket.connect');
      span.setAttr('ws.service', name);
      span.setAttr('ws.retries', current.retries);
      const phase = span.span('auth.session_socket.resolve_url');
      current.attempt = { span, phase };
      try {
        // Auth refresh HTTP calls inherit this context; the upgrade itself has
        // no trace headers (the account WS backends do not accept trace queries).
        const url = await phase.run(resolve);
        if (session !== current) return url;
        phase.setAttr('outcome', 'resolved');
        phase.end();
        current.attempt = {
          span,
          phase: span.span('auth.session_socket.handshake'),
        };
        return url;
      } catch (error) {
        finishAttempt(current, 'url-resolution-failed', true);
        throw error;
      }
    },

    opened() {
      if (!session) return;
      finishAttempt(session, 'connected');
      session.retries = 0;
    },

    failed() {
      if (session) finishAttempt(session, 'connection-failed', true);
    },

    closed(event: { code: number; wasClean: boolean }) {
      if (!session) return;
      finishAttempt(session, 'closed-before-open', true);
      const closing = session.root.span('auth.session_socket.close');
      closing.setAttr('ws.service', name);
      closing.setAttr('ws.close_code', event.code);
      closing.setAttr('ws.was_clean', event.wasClean);
      closing.setAttr('outcome', 'disconnected');
      closing.end();
    },

    retry(event: { retries: number; backoff: number }) {
      if (!session) return;
      session.retries = event.retries;
      const retry = session.root.span('auth.session_socket.retry');
      retry.setAttr('ws.service', name);
      retry.setAttr('ws.retries', event.retries);
      retry.setAttr('ws.backoff_ms', event.backoff);
      retry.setAttr('outcome', 'retrying');
      retry.end();
    },
  };
}
