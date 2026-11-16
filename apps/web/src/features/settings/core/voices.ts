import type { Voice } from '@service-agent-harness/generated/schemas';
import type { AgentVoice } from '@service-auth/team-agents';
import type { Accessor } from 'solid-js';

/** The voice catalog and its samples, as the voice picker reads them. */
export type VoicePickerSource = {
  choices: Accessor<readonly Voice[]>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  retry(): void;
  /** WAV bytes of the voice saying a fixed line. */
  sample(model: string): Promise<Uint8Array>;
};

/**
 * The voice to suggest for a persona: the first English voice whose
 * provider tags appear in the personality, else the first English voice.
 * Tags are matched as written; nothing is inferred from the name.
 */
export function recommendedVoice(
  voices: readonly Voice[],
  personality: string
): Voice | undefined {
  const words = new Set(
    personality
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3)
  );
  const english = voices.filter((voice) =>
    voice.languages.some((language) => language.toLowerCase().startsWith('en'))
  );
  const options = english.length > 0 ? english : voices;
  return (
    options.find((voice) =>
      voice.tags.some((tag) => words.has(tag.toLowerCase()))
    ) ?? options[0]
  );
}

/**
 * The voice an agent speaks with until one is saved: the starter agent's
 * `defaultVoice` (`packages/starter-agent/behavior/capabilities/calls/voices.ts`).
 */
export const defaultAgentVoice = 'aura-2-thalia-en';

/**
 * The voice to show as the agent's: the saved one, the default when none is
 * saved (`null`), and nothing while it loads (`undefined`).
 */
export function currentVoice(
  saved: AgentVoice | null | undefined
): string | undefined {
  if (saved === undefined) return undefined;
  return saved?.model ?? defaultAgentVoice;
}
