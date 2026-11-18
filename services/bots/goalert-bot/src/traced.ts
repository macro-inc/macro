import { type Span, Telemetry } from '@macro-inc/observability';
import type { AlertChannel } from './channel';
import type { AlertStore } from './store';

/** Run `operation` in a child span named `name`, marking it failed on error. */
async function traced<T>(
  name: string,
  attributes: Record<string, string | number>,
  operation: (span: Span) => Promise<T>
): Promise<T> {
  return Telemetry.span(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttr(key, value);
    }
    try {
      return await operation(span);
    } catch (error) {
      span.error(error);
      throw error;
    }
  });
}

/** The channel with one span per call. Bodies are not recorded. */
export function tracedChannel(channel: AlertChannel): AlertChannel {
  return {
    post: (body) =>
      traced('goalert_bot.channel.post', {}, async (span) => {
        const messageId = await channel.post(body);
        span.setAttr('goalert.message_id', messageId);
        return messageId;
      }),
    reply: (messageId, body) =>
      traced(
        'goalert_bot.channel.reply',
        { 'goalert.message_id': messageId },
        () => channel.reply(messageId, body)
      ),
    react: (messageId, emoji) =>
      traced(
        'goalert_bot.channel.react',
        { 'goalert.message_id': messageId },
        () => channel.react(messageId, emoji)
      ),
    edit: (messageId, body) =>
      traced(
        'goalert_bot.channel.edit',
        { 'goalert.message_id': messageId },
        () => channel.edit(messageId, body)
      ),
  };
}

/** The alert store with one span per KV call, recording hit or miss. */
export function tracedStore(store: AlertStore): AlertStore {
  return {
    get: (alertId) =>
      traced(
        'goalert_bot.kv.get',
        { 'goalert.alert_id': alertId },
        async (span) => {
          const posted = await store.get(alertId);
          span.setAttr('goalert.found', posted !== undefined);
          return posted;
        }
      ),
    put: (alertId, posted) =>
      traced('goalert_bot.kv.put', { 'goalert.alert_id': alertId }, () =>
        store.put(alertId, posted)
      ),
  };
}
