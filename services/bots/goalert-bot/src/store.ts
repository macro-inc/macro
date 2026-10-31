import { z } from 'zod';

/** How long a posted alert's thread stays reachable by later status changes. */
const ALERT_TTL_SECONDS = 30 * 24 * 60 * 60;

const postedAlertSchema = z.object({
  messageId: z.string(),
  // Kept so a close can rewrite the headline without fetching the message.
  post: z.object({
    page: z.boolean(),
    headline: z.string(),
    lines: z.array(z.string()),
  }),
});

/** The channel message an alert was posted as. */
export type PostedAlert = z.infer<typeof postedAlertSchema>;

/** GoAlert alert id → the message it was posted as. */
export type AlertStore = {
  get(alertId: number): Promise<PostedAlert | undefined>;
  put(alertId: number, posted: PostedAlert): Promise<void>;
};

/** The subset of a Workers KV namespace binding this store uses. */
export type KeyValueNamespace = {
  get(key: string, type: 'json'): Promise<unknown>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number }
  ): Promise<void>;
};

function key(alertId: number): string {
  return `alert:${alertId}`;
}

/** Store backed by a Workers KV namespace; entries expire after 30 days. */
export function createKvAlertStore(kv: KeyValueNamespace): AlertStore {
  return {
    async get(alertId) {
      const value = await kv.get(key(alertId), 'json');
      if (value === null) return undefined;
      const parsed = postedAlertSchema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    },
    async put(alertId, posted) {
      await kv.put(key(alertId), JSON.stringify(posted), {
        expirationTtl: ALERT_TTL_SECONDS,
      });
    },
  };
}

/** In-process store for the local Bun server and tests. */
export function createMemoryAlertStore(): AlertStore {
  const entries = new Map<number, PostedAlert>();
  return {
    get: async (alertId) => entries.get(alertId),
    put: async (alertId, posted) => {
      entries.set(alertId, posted);
    },
  };
}
