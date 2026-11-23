import { isChannelId } from '../channel-id';

const NAMES = new Map<string, string>();

/** A channel id the server could parse, made from a readable test name: the
 * name's bytes in hex, padded with zeros. An id is returned as it is. No
 * test runner imports, so a Vite fixture can use it. */
export function channelUuid(name: string): string {
  if (isChannelId(name)) return name;
  const bytes = new TextEncoder().encode(name);
  if (bytes.length > 16) throw new Error(`test channel name too long: ${name}`);
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0');
  const id = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
  NAMES.set(id, name);
  return id;
}

/** The test name `channelUuid` made `id` from, or `id` itself. */
export function channelName(id: string): string {
  return NAMES.get(id) ?? id;
}
