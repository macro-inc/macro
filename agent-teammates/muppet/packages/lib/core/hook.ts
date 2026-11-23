import type { EventContext, WakeContext } from "./agent.ts";
import { channel, type Source } from "./event.ts";

/**
 * Events from the system's own lifecycle, as sources. Every behavior can
 * subscribe to them under `sources.hooks`; the runtime fires them.
 */
export type Hooks = {
	/** Before the agent is woken. Handlers may `add` text to the end of its system prompt, e.g. memories. */
	readonly preWake: Source<{
		readonly wake: WakeContext;
		readonly add: (text: string) => void;
	}>;
	/** After the agent has replied to a wake. */
	readonly postReply: Source<{
		readonly wake: WakeContext;
		readonly reply: string;
	}>;
	/** After a capability has written state. Nothing fires this yet. */
	readonly postStateUpdate: Source<{ readonly path: string }>;
	/**
	 * After something failed. Later events and wakes still happen. A behavior
	 * only runs once a handler is subscribed to this, so no failure goes
	 * unseen; a handler on it that itself throws is not reported again.
	 */
	readonly failed: Source<Failure>;
};

/** What failed, told apart by `kind`. */
export type Failure =
	/** A wake failed: the agent threw, or reported that it failed. */
	| {
			readonly kind: "wake";
			readonly wake: WakeContext;
			readonly error: string;
	  }
	/** A handler threw, with the event it was handling. Its source goes on to the next event. */
	| {
			readonly kind: "handler";
			readonly event: EventContext;
			readonly error: string;
	  };

/** One run's hooks, and the means to fire them. Firing resolves once every handler on the hook has finished. */
export type Lifecycle = {
	readonly hooks: Hooks;
	readonly fire: {
		readonly [Name in keyof Hooks]: Hooks[Name] extends Source<infer Payload>
			? (payload: Payload) => Promise<void>
			: never;
	};
	readonly close: () => void;
};

export const lifecycle = (): Lifecycle => {
	const preWake = channel<{
		readonly wake: WakeContext;
		readonly add: (text: string) => void;
	}>();
	const postReply = channel<{
		readonly wake: WakeContext;
		readonly reply: string;
	}>();
	const postStateUpdate = channel<{ readonly path: string }>();
	const failed = channel<Failure>();
	return {
		hooks: {
			preWake: preWake.source,
			postReply: postReply.source,
			postStateUpdate: postStateUpdate.source,
			failed: failed.source,
		},
		fire: {
			preWake: preWake.push,
			postReply: postReply.push,
			postStateUpdate: postStateUpdate.push,
			failed: failed.push,
		},
		close: () => {
			preWake.close();
			postReply.close();
			postStateUpdate.close();
			failed.close();
		},
	};
};
