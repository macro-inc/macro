import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createEffect, onCleanup } from 'solid-js';

/** Keep server error bodies and pairing material out of operation telemetry. */
export function whatsappOperation<T>(
  name: string,
  operation: () => Promise<T>,
  groupId?: string
) {
  return Telemetry.span(`whatsapp.${name}`, async (span) => {
    if (groupId) span.setAttr('whatsapp.group.id', groupId);
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

export type WhatsappLoadResult = {
  outcome: 'success' | 'error';
  /** Opaque ids and counts only. */
  attrs?: Record<string, string | number | boolean>;
};

/**
 * One span from mount until `settled` first reports an outcome, such as a
 * page whose reads have all loaded; unmounting first records `abandoned`.
 */
export function traceWhatsappLoad(
  name: string,
  settled: Accessor<WhatsappLoadResult | undefined>
) {
  const span = Telemetry.span(`whatsapp.${name}`);
  let ended = false;
  const end = (result: WhatsappLoadResult | { outcome: 'abandoned' }) => {
    if (ended) return;
    ended = true;
    span.setAttr('whatsapp.outcome', result.outcome);
    if ('attrs' in result)
      for (const [key, value] of Object.entries(result.attrs ?? {}))
        span.setAttr(key, value);
    if (result.outcome === 'error') span.error(`WhatsApp ${name} failed`);
    span.end();
  };
  createEffect(() => {
    const result = settled();
    if (result) end(result);
  });
  onCleanup(() => end({ outcome: 'abandoned' }));
}
