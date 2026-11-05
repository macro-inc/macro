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

const voiceSchema = z.object({
  model: z
    .string()
    .regex(/^aura-2-[a-z]+-[a-z]{2}$/)
    .max(100),
});
export function parseVoiceConfig(value: unknown): { model: string } {
  return voiceSchema.parse(value);
}
