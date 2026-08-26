import type { Persona } from '@service-storage/generated/schemas/persona';
import { z } from 'zod';

const personaFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(128),
  handle: z
    .string()
    .trim()
    .min(1, 'Enter a mention handle.')
    .max(64, 'Mention handle must be 64 characters or fewer.')
    .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, '-' or '_' only."),
  description: z.string().trim().max(500),
  avatarUrl: z.string().trim(),
  systemPrompt: z.string(),
});

export type PersonaFormValues = z.infer<typeof personaFormSchema>;
export type PersonaFormErrors = Partial<
  Record<keyof PersonaFormValues, string>
>;

export const EMPTY_PERSONA_FORM: PersonaFormValues = {
  name: '',
  handle: '',
  description: '',
  avatarUrl: '',
  systemPrompt: '',
};

export function personaToFormValues(persona: Persona): PersonaFormValues {
  return {
    name: persona.name,
    handle: persona.handle,
    description: persona.description ?? '',
    avatarUrl: persona.avatar_url ?? '',
    systemPrompt: persona.system_prompt ?? '',
  };
}

export function validatePersonaForm(values: PersonaFormValues) {
  const result = personaFormSchema.safeParse(values);
  if (result.success) return result;

  const fieldErrors = result.error.flatten().fieldErrors;
  return {
    success: false as const,
    errors: Object.fromEntries(
      Object.entries(fieldErrors).map(([field, messages]) => [
        field,
        messages?.[0],
      ])
    ) as PersonaFormErrors,
  };
}
