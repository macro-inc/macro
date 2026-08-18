import type { AgentConfig } from '@service-storage/generated/schemas/agentConfig';
import type { AgentModel } from '@service-storage/generated/schemas/agentModel';
import type { Harness } from '@service-storage/generated/schemas/harness';
import type { Persona } from '@service-storage/generated/schemas/persona';
import { z } from 'zod';

/** The one harness and model we launch today. Both are closed sets on the
 * backend, so the selects exist to make that visible rather than to offer a
 * choice that does not exist yet. */
export const HARNESS_OPTIONS: { value: Harness; label: string }[] = [
  { value: 'open_code', label: 'opencode' },
];

export const MODEL_OPTIONS: { value: AgentModel; label: string }[] = [
  { value: 'claude', label: 'Claude Sonnet' },
];

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
  harness: z.custom<Harness>(),
  model: z.custom<AgentModel>(),
  // Blank means no checkout. Anything else has to survive being handed to
  // `git clone` inside the sandbox, which is why the backend rejects the same
  // shapes this does.
  repoUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || value.startsWith('https://'), {
      message: 'Repository URL must start with https://.',
    })
    .refine((value) => !/[\s"'`$\\;|&<>()]/.test(value), {
      message: 'Repository URL contains illegal characters.',
    }),
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
  harness: 'open_code',
  model: 'claude',
  repoUrl: '',
};

export function personaToFormValues(persona: Persona): PersonaFormValues {
  return {
    name: persona.name,
    handle: persona.handle,
    description: persona.description ?? '',
    avatarUrl: persona.avatar_url ?? '',
    systemPrompt: persona.agent.system_prompt ?? '',
    harness: persona.agent.harness,
    model: persona.agent.model,
    repoUrl: persona.agent.repo_url ?? '',
  };
}

/** Empty strings are how the form spells "unset"; the API spells it `null`. */
export function formValuesToAgentConfig(
  values: PersonaFormValues
): AgentConfig {
  return {
    harness: values.harness,
    model: values.model,
    system_prompt: values.systemPrompt.trim() ? values.systemPrompt : null,
    repo_url: values.repoUrl.trim() ? values.repoUrl.trim() : null,
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
