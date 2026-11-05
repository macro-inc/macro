import type { Voice } from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';

export type VoicePickerSource = {
  choices: Accessor<Voice[]>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  retry(): void;
  sample(model: string): Promise<Uint8Array>;
};

/** Prefer a provider-described voice that matches the persona, without inferring gender. */
export function recommendedVoice(
  voices: Voice[],
  personality: string
): Voice | undefined {
  const words = personality
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
  const english = voices.filter((voice) =>
    voice.languages.some((language) => language.toLowerCase().startsWith('en'))
  );
  const options = english.length ? english : voices;
  return (
    options.find((voice) =>
      voice.tags.some((tag) => words.includes(tag.toLowerCase()))
    ) ?? options[0]
  );
}
