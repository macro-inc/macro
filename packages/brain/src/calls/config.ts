import { z } from 'zod';
import type { CallsConfig } from './watch.ts';

const schema = z.object({
  channels: z.array(z.string().min(1)),
  blockedChannels: z.array(z.string().min(1)),
  hungUp: z.array(z.string().min(1)),
});
export function parseCallsConfig(value: unknown): CallsConfig {
  return schema.parse(value);
}
