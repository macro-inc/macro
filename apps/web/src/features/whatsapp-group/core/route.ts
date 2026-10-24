import { z } from 'zod';

const prefix = 'whatsapp-group:';
/** The split manager stores native, block-free entities as component identities. */
export function whatsappGroupComponentId(groupId: string): string {
  return `${prefix}${groupId}`;
}
export function parseWhatsAppGroupComponentId(
  componentId: string
): string | undefined {
  if (!componentId.startsWith(prefix)) return;
  return z.uuid().safeParse(componentId.slice(prefix.length)).data;
}
