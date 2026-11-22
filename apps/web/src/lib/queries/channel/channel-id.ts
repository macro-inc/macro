const CHANNEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` can name a channel. The server parses every id a by-id read
 * names as a UUID, and one it cannot parse fails the whole read, so an id
 * from a mistyped link must never join one. */
export function isChannelId(id: string): boolean {
  return CHANNEL_ID.test(id);
}
