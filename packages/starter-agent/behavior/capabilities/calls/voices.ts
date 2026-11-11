/**
 * The ears and the voice, on LiveKit's stock options, in one place.
 * Everything not set here is LiveKit's default, and tuning means changing a
 * documented option here, never code on top of the session.
 * `context/` builds the real objects from these.
 */
import type { voice } from '@livekit/agents';
import { z } from 'zod';

/**
 * The session's options. VAD turn detection: the on-device detector needs
 * an inference process that only exists under a LiveKit worker, and a call
 * here runs without one. Then the three non-default ones:
 * - user-away off: a quiet caller isn't away;
 * - AEC warm-up off: the agent can be interrupted from its first word, and
 *   there is no echo in a room track;
 * - preemptive generation off: the brain is one stateful session, and a
 *   guess would land in its history.
 */
export const sessionOptions = {
  userAwayTimeout: null,
  aecWarmupDuration: null,
  turnHandling: {
    turnDetection: 'vad',
    preemptiveGeneration: { enabled: false },
  },
} satisfies Pick<
  voice.AgentSessionOptions,
  'userAwayTimeout' | 'aecWarmupDuration' | 'turnHandling'
>;

/** An Aura-2 voice: `aura-2-<voice>-<language>`. */
export type Voice = { readonly voice: string; readonly language: string };

/** The voice an agent has until its owner picks one. */
export const defaultVoice = 'aura-2-thalia-en';

const VoiceFile = z.object({
  model: z
    .string()
    .max(100)
    .regex(/^aura-2-[a-z]+-[a-z]{2}$/),
});

const named = (model: string): Voice => {
  const [, , voice = '', language = ''] = model.split('-');
  return { voice, language };
};

/**
 * The voice in the agent's `config/voice.json`, which Macro's agent settings
 * write; the default when there is no file. A file that isn't a voice throws:
 * a call in the wrong voice is worse than a call that says why it failed.
 */
export const parseVoice = (text: string | undefined): Voice => {
  if (text === undefined) return named(defaultVoice);
  return named(VoiceFile.parse(JSON.parse(text)).model);
};
