import type { Span } from '@macro-inc/observability';
import type { OperationResult } from '@urql/core';

// Result-local context never enters GraphQL extensions, storage, or the wire.
// Weak keys also retire receipts on uncached clients, which do not consume it.
const RECEIPT_SPANS = new WeakMap<OperationResult, Span>();

export function setSubscriptionCacheTrace(result: OperationResult, span: Span) {
  RECEIPT_SPANS.set(result, span);
}

/** Keep cache phases linked to receipt without extending or delaying delivery. */
export async function runSubscriptionCacheEffects(
  result: OperationResult,
  previous: Promise<boolean>,
  apply: (span?: Span) => Promise<boolean>
): Promise<boolean> {
  const receipt = RECEIPT_SPANS.get(result);
  RECEIPT_SPANS.delete(result);
  if (!receipt) {
    await previous;
    return await apply();
  }

  const queued = receipt.span('graphql.subscription.cache_queue');
  try {
    await previous;
  } catch (error) {
    queued.error('Subscription cache queue failed');
    throw error;
  } finally {
    queued.end();
  }

  return await receipt.span(
    'graphql.subscription.cache_apply',
    async (span) => {
      try {
        const applied = await apply(span);
        span.setAttr('cache.effects_applied', applied);
        return applied;
      } catch (error) {
        span.error('Subscription cache application failed');
        throw error;
      }
    }
  );
}
