import { Telemetry } from '@macro-inc/observability';

/** Keep server error bodies, codes, emails and sessions out of telemetry. */
export function slackOperation<T>(
  name: string,
  operation: () => Promise<T>,
  /** Opaque ids and counts only. */
  attrs: Record<string, string | number | boolean> = {}
) {
  return Telemetry.span(`slack.${name}`, async (span) => {
    for (const [key, value] of Object.entries(attrs)) span.setAttr(key, value);
    try {
      const result = await operation();
      span.setAttr('slack.outcome', 'success');
      return result;
    } catch (error) {
      span.error('Slack operation failed');
      throw error;
    }
  });
}
