import type { Bot } from '@service-storage/generated/schemas/bot';
import { z } from 'zod';

const botFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a bot name.').max(128),
  handle: z
    .string()
    .trim()
    .min(1, 'Enter a mention handle.')
    .max(64, 'Mention handle must be 64 characters or fewer.')
    .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, '-' or '_' only."),
  description: z.string().trim().max(500),
  avatarUrl: z.string().trim(),
});

export type BotFormValues = z.infer<typeof botFormSchema>;
export type BotFormErrors = Partial<Record<keyof BotFormValues, string>>;

export const EMPTY_BOT_FORM: BotFormValues = {
  name: '',
  handle: '',
  description: '',
  avatarUrl: '',
};

export function botToFormValues(bot: Bot): BotFormValues {
  return {
    name: bot.name,
    handle: bot.handle,
    description: bot.description ?? '',
    avatarUrl: bot.avatar_url ?? '',
  };
}

export function slugBotHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function validateBotForm(values: BotFormValues) {
  const result = botFormSchema.safeParse(values);
  if (result.success) return result;

  const fieldErrors = result.error.flatten().fieldErrors;
  return {
    success: false as const,
    errors: Object.fromEntries(
      Object.entries(fieldErrors).map(([field, messages]) => [
        field,
        messages?.[0],
      ])
    ) as BotFormErrors,
  };
}
