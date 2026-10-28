import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createEffect, onCleanup } from 'solid-js';

/** Keep server error bodies and pairing material out of operation telemetry. */
export function whatsappOperation<T>(
  name: string,
  operation: () => Promise<T>,
  /** Opaque labels only, such as why the operation ran. */
  attrs: Record<string, string> = {}
) {
  return Telemetry.span(`whatsapp.${name}`, async (span) => {
    for (const [key, value] of Object.entries(attrs)) span.setAttr(key, value);
    try {
      const result = await operation();
      span.setAttr('whatsapp.outcome', 'success');
      return result;
    } catch (error) {
      span.error('WhatsApp operation failed');
      throw error;
    }
  });
}

export type LoadResult = {
  outcome: 'success' | 'error';
  /** Opaque ids and counts only. */
  attrs?: Record<string, string | number | boolean>;
};

/**
 * One span from mount until `settled` first reports an outcome, such as a
 * page whose reads have all loaded; unmounting first records `abandoned`.
 */
export function traceLoad(
  /** The full span name, such as `whatsapp.page.load`. */
  name: string,
  settled: Accessor<LoadResult | undefined>
) {
  const span = Telemetry.span(name);
  let ended = false;
  const end = (result: LoadResult | { outcome: 'abandoned' }) => {
    if (ended) return;
    ended = true;
    span.setAttr('outcome', result.outcome);
    if ('attrs' in result)
      for (const [key, value] of Object.entries(result.attrs ?? {}))
        span.setAttr(key, value);
    if (result.outcome === 'error') span.error(`${name} failed`);
    span.end();
  };
  createEffect(() => {
    const result = settled();
    if (result) end(result);
  });
  onCleanup(() => end({ outcome: 'abandoned' }));
}
