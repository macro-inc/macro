/**
 * Starting a span about one session, the same way everywhere: named, stamped
 * with the session id, and never able to throw into the caller — the callers
 * are load and control paths that must not break because telemetry did.
 */

import type { Span } from '@macro-inc/observability';
import { Telemetry } from '@macro-inc/observability';

export function startSessionSpan(
  name: string,
  sessionId: string
): Span | undefined {
  try {
    const span = Telemetry.span(name);
    span.setAttr('agent.session.id', sessionId);
    return span;
  } catch {
    return undefined;
  }
}
