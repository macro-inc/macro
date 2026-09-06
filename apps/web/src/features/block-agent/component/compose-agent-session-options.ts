/** A persona the composer can start a managed session as. */
export type PersonaOption = {
  id: string;
  /** Persisted bot id; absent for the deployment's built-in default persona. */
  botId?: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  harness: string;
  defaultModel?: string;
};

/** A model the user can pin the session to instead of the persona default. */
export type ModelOption = {
  id: string;
  name: string;
};

/**
 * The models offered as explicit overrides. The persona's own default is
 * already the "Persona default" choice, so listing it again would offer two
 * rows that do the same thing.
 */
export function overrideModelOptions(
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): ModelOption[] {
  const defaultModel = persona?.defaultModel;
  return defaultModel
    ? available.filter((model) => model.id !== defaultModel)
    : [...available];
}

/**
 * Label for the "leave the model alone" choice. Names the persona's default
 * when it is known so the user sees what they will get without overriding.
 */
export function personaDefaultLabel(
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): string {
  const defaultModel = persona?.defaultModel;
  if (!defaultModel) return 'Persona default';
  const name =
    available.find((model) => model.id === defaultModel)?.name ?? defaultModel;
  return `Persona default · ${name}`;
}

/** Short label for the closed model pill. */
export function modelPillLabel(
  override: string,
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): string {
  if (override) {
    return available.find((model) => model.id === override)?.name ?? override;
  }
  const defaultModel = persona?.defaultModel;
  if (!defaultModel) return 'Default model';
  return (
    available.find((model) => model.id === defaultModel)?.name ?? defaultModel
  );
}
