import { z } from 'zod';

const prefix = 'whatsapp-group:';
/**
 * Groups once opened as their own `whatsapp-group:<id>` split component;
 * restored layouts still carry that identity and now open in External.
 */
export function parseWhatsAppGroupComponentId(
  componentId: string
): string | undefined {
  if (!componentId.startsWith(prefix)) return;
  return z.uuid().safeParse(componentId.slice(prefix.length)).data;
}
