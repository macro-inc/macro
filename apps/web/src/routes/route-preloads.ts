import { preloadComponent } from '@app/lib/split-router/router/preload';
import type { SplitRoutePreloadContext } from '@app/lib/split-router/routes/types';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { blocks, fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { hasLoginCookie } from '@core/util/cookies';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';

async function preloadData(context: SplitRoutePreloadContext, span: Span) {
  const { reference, signal } = context;
  if (!reference || signal.aborted) return;
  const type = fileTypeToResolvedBlockName(reference.type);
  if (type === 'md') {
    const { fetchDocumentLoadBundle } = await import(
      '@queries/storage/documentLoad/documentLoadBundle'
    );
    if (!signal.aborted)
      await span.run(() => fetchDocumentLoadBundle(reference.id));
  } else if (type === 'channel') {
    const { prefetchChannelMessages, prefetchChannelTarget } = await import(
      '@channel/queries/prefetch-channel-target'
    );
    if (signal.aborted) return;
    const messageId = reference.params?.[CHANNEL_URL_PARAMS.message];
    const threadId = reference.params?.[CHANNEL_URL_PARAMS.thread];
    if (messageId)
      await span.run(() =>
        prefetchChannelTarget(reference.id, { messageId, threadId })
      );
    else await span.run(() => prefetchChannelMessages(reference.id));
  } else if (type === 'email') {
    const { fetchAndCacheThread } = await import('@queries/email/thread');
    if (!signal.aborted)
      await span.run(() => fetchAndCacheThread(reference.id));
  }
}

async function warmCode(component: unknown, span: Span) {
  try {
    await span.span('block.preload.code', () => preloadComponent(component));
  } catch {
    /* The mounted view owns chunk errors and retries. */
  }
}

/** Warm code and query data; activation belongs to the mounted view. */
export function preloadRouteReference(
  context: SplitRoutePreloadContext
): Promise<void> | undefined {
  if (!context.reference || context.signal.aborted) return;
  const type = fileTypeToResolvedBlockName(context.reference.type);
  const span = Telemetry.span('block.preload', { sampling: 'perf' });
  span.setAttr('block.type', type);
  const code = warmCode(blocks[type].component, span);
  const data =
    hasLoginCookie() && ['md', 'channel', 'email'].includes(type)
      ? span.span('block.preload.data', (child) => preloadData(context, child))
      : undefined;
  fireAndForget(finishPreload(code, data, span), 'route-preload');
  // Hover callers can await warm-up. Activation must mount the consumer now,
  // so its own loads run alongside these reads instead of after them.
  return context.intent === 'hover' ? data : undefined;
}

async function finishPreload(
  code: Promise<unknown>,
  data: Promise<unknown> | undefined,
  span: Span
) {
  const outcomes = await Promise.allSettled([code, data]);
  span.setAttr(
    'preload.outcome',
    outcomes.every((result) => result.status === 'fulfilled')
      ? 'settled'
      : 'failed'
  );
  span.end();
}
