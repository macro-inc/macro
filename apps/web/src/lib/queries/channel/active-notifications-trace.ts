import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';

/**
 * The first not-done read's span, from when the channel enables it until its
 * first answer, so the request and the server's spans under it are found by
 * channel. It joins the channel view's trace while that view still loads.
 * Later refreshes are sent outside it.
 */
export function createReadTrace(options: {
  channelId: string;
  limit: number;
  /** The enclosing view's trace, joined while that view still loads. */
  flow: TraceContext | undefined;
}) {
  const { channelId, limit, flow } = options;
  let span: Span | undefined;
  let done = false;
  const start = () => {
    const open = () => Telemetry.span('channel.active_notifications.read');
    const opened = flow ? flow.run(open) : open();
    opened.setAttr('channel.id', channelId);
    opened.setAttr('notification.limit', limit);
    return opened;
  };
  // The transport runs each request in this context as it sends it, so the
  // span opens with the first request and never for an answer from cache.
  const context: TraceContext = {
    run(work) {
      if (!span && !done) span = start();
      return span ? span.run(work) : work();
    },
  };

  return {
    context,
    finish(outcome: { count?: number; error?: unknown; cancelled?: boolean }) {
      if (!span) return;
      if (outcome.count !== undefined) {
        span.setAttr('notification.count', outcome.count);
        span.setAttr('notification.limit_reached', outcome.count >= limit);
      }
      if (outcome.cancelled) span.setAttr('read.cancelled', true);
      if (outcome.error) span.error(outcome.error);
      span.end();
      span = undefined;
      done = true;
    },
  };
}
