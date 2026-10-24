import { Telemetry } from '@macro-inc/observability';

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
