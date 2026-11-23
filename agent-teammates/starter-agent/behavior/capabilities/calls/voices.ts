/**
 * The ears and the voice, on LiveKit's stock options, in one place.
 * Everything not set here is LiveKit's default, and tuning means changing a
 * documented option here, never code on top of the session.
 * `context/` builds the real objects from these.
 */
import type { voice } from "@livekit/agents";
import { deepgramKey, inworldKey } from "./config.ts";

/** Deepgram Nova-3. It is also told the agent's name, so it spells it right. */
export const hearingOptions = { model: "nova-3" } as const;

/**
 * The voice: a spec `parseTts` reads. Deepgram by default, because calls
 * need its key for hearing anyway. To change it, set another spec here (an
 * Inworld voice needs INWORLD_API_KEY too).
 */
export const voiceSpec = "deepgram:aura-2-thalia-en";
/**
 * If a voice from another vendor fails or runs dry, LiveKit's
 * FallbackAdapter speaks with this one rather than go silent.
 */
export const fallbackSpec = "deepgram:aura-2-thalia-en";

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
		turnDetection: "vad",
		preemptiveGeneration: { enabled: false },
	},
} satisfies Pick<
	voice.AgentSessionOptions,
	"userAwayTimeout" | "aecWarmupDuration" | "turnHandling"
>;

/** A voice by vendor: `deepgram:<model>` or `inworld:<model>:<voice>`. */
export type TtsSpec =
	| { readonly vendor: "deepgram"; readonly model: string }
	| {
			readonly vendor: "inworld";
			readonly model: string;
			readonly voice?: string;
	  };

export const parseTts = (spec: string): TtsSpec => {
	const [vendor, model, voiceName] = spec.split(":");
	if (model === undefined || model === "") throw new Error(`no TTS ${spec}`);
	if (vendor === "deepgram") return { vendor, model };
	if (vendor === "inworld") return { vendor, model, voice: voiceName };
	throw new Error(`no TTS ${spec}`);
};

/** The credential a voice needs, by name. */
export const ttsCredential = ({ vendor }: TtsSpec): string =>
	vendor === "deepgram" ? deepgramKey : inworldKey;

/** Whether a voice needs a fallback: one from Deepgram is already the fallback's vendor. */
export const needsFallback = (spec: string): boolean =>
	parseTts(spec).vendor !== parseTts(fallbackSpec).vendor;
