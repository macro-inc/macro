/**
 * What the parts of calls say to each other: the shapes that cross between
 * the arbiter, the ledgers, a call's process, and Macro. Each part owns its
 * own logic; these are the nouns they share.
 */
import type { Room } from "@livekit/rtc-node";
import type { ScreenFrame, ScreenShare } from "@macro-inc/sdk/calls/node";
import { z } from "zod";

/** One line of a call's flight recorder: `t` is milliseconds since the join started. */
export const CallEvent = z.looseObject({ t: z.number(), type: z.string() });
export type CallEvent = z.infer<typeof CallEvent>;

/** Writes one event to the call's log. Never throws, never waits on the disk. */
export type Emit = (
	type: string,
	data?: Readonly<Record<string, unknown>>,
) => void;

/** Why Macro wouldn't seat the agent. */
export const Refusal = z.enum([
	"in_other_call",
	"already_connected",
	"ended",
	"rate_limited",
	"refused",
	"flag_off",
]);
export type Refusal = z.infer<typeof Refusal>;

/** How a call is reached: a channel's call by the channel's id, a meeting by its invitation token. */
export const JoinKind = z.enum(["channel", "meeting"]);
export type JoinKind = z.infer<typeof JoinKind>;
export type JoinArgs = readonly [kind: JoinKind, id: string];

/** A live call in a channel the agent is in. */
export type ActiveCall = {
	readonly callId: string;
	readonly channelId: string;
	readonly createdBy: string;
	readonly createdAt?: string;
	readonly participantCount?: number;
};

/** A live meeting the agent made, was in, or is invited to. */
export type ActiveMeeting = {
	readonly id: string;
	readonly callId: string;
	readonly title: string;
	/** Its invitation token, which is how it's joined. Null if Macro gave none. */
	readonly token: string | null;
	readonly createdBy: string;
};

export type ChannelMessage = {
	readonly id: string;
	readonly from: string;
	readonly fromId: string;
	readonly at: string;
	readonly text: string;
};

/** Who is speaking on a call, from the room, and whether they're alone with the agent. Never from what anyone says. */
export type Speaker = { readonly id: string; readonly alone: boolean };

/** Who asked for something, from Macro's own record of a message or the call's room, never from what a run claims. `sure` is false when a group call can't say who spoke. */
export type Asked = { readonly id: string; readonly sure: boolean };

/** A time as the ledgers store it, ISO 8601, read back as an instant. */
export const At = z.string().transform((value) => Temporal.Instant.from(value));

/** An instant as a ledger row stores it: to the millisecond, so rows keep their order. */
export const atText = (at: Temporal.Instant): string =>
	at.toString({ smallestUnit: "millisecond" });

export const PlaceEvent = z.enum([
	"queued",
	"refused",
	"joined",
	"answered",
	"no_answer",
	"ended",
	"expired",
]);
export type PlaceEvent = z.infer<typeof PlaceEvent>;

/** One line of the outbound ledger: a request to place a call, or something that happened to one. */
export const PlaceRow = z.object({
	at: At,
	id: z.string().optional(),
	event: PlaceEvent,
	asker: z.string().nullish(),
	target: z.string().optional(),
	channelId: z.string().optional(),
	reason: z.string().optional(),
	rule: z.string().optional(),
	why: z.string().optional(),
	callId: z.string().optional(),
});
export type PlaceRow = z.infer<typeof PlaceRow>;
/** A row as it is added: the ledger stamps the time unless one is given. */
export type NewPlaceRow = Omit<PlaceRow, "at"> & {
	readonly at?: Temporal.Instant;
};

/** A call the agent was asked to place and hasn't finished. */
export type Placed = {
	readonly id: string;
	readonly channelId: string;
	readonly target: string;
	readonly asker: string | null;
	readonly reason: string;
	readonly rule: string;
	readonly at: Temporal.Instant;
	/** Its join got a token, which is what rings them. */
	readonly joined?: boolean;
	readonly answered?: boolean;
	/** The room its dial landed in. */
	readonly callId?: string;
};

/** What the switch judgment said about an ask, and the call the agent was on when it said it. */
export const SwitchVerdict = z.object({
	go: z.boolean(),
	reason: z.string(),
	need: z.string(),
	by: z.enum(["rule", "model"]),
	current: z.string().nullable(),
});
export type SwitchVerdict = z.infer<typeof SwitchVerdict>;

export const AskEvent = z.enum([
	"asked",
	"weighed",
	"answered",
	"moved",
	"closed",
]);

/** One line of the asks ledger. */
export const AskRow = z.object({
	at: At,
	id: z.string(),
	event: AskEvent,
	from: z.string().optional(),
	name: z.string().optional(),
	text: z.string().optional(),
	callId: z.string().optional(),
	channel: z.string().optional(),
	root: z.string().optional(),
	verdict: SwitchVerdict.optional(),
	line: z.string().optional(),
	why: z.string().optional(),
});
export type AskRow = z.infer<typeof AskRow>;
export type NewAskRow = Omit<AskRow, "at"> & { readonly at?: Temporal.Instant };

/** Someone asked the agent to come. Who asked comes from Macro's record of their message. */
export type Ask = {
	readonly id: string;
	readonly from: string;
	readonly name: string;
	readonly text: string;
	readonly callId: string;
	readonly at: Temporal.Instant;
	readonly answered?: boolean;
	readonly verdict?: SwitchVerdict;
};

/** The asks ledger, read: what's open, and what the limits count. */
export type Asks = {
	readonly open: readonly Ask[];
	/** Per call: how many times an ask for it went to the model, and when last. */
	readonly weighed: ReadonlyMap<
		string,
		{ readonly count: number; readonly last: Temporal.Instant }
	>;
	/** When a request moved the agent. */
	readonly moves: readonly Temporal.Instant[];
};

/** May this call be placed? Allowed means queued. */
export type PlaceVerdict =
	| { readonly ok: true; readonly rule: string }
	| { readonly ok: false; readonly rule: string; readonly why: string };

/** A request to ring someone. Who asked is `asked` (from the room) or the author of `message` (from Macro), never a claim. */
export type PlaceInput = {
	readonly target: string;
	readonly reason: string;
	readonly asked?: Asked;
	readonly message?: { readonly channel: string; readonly id: string };
};
export type PlaceOutcome = PlaceVerdict & { readonly id?: string };

/** What the brain can do with the screen on a call. Each returns the line the brain reads back. */
export type DriveAction = {
	readonly action: "navigate" | "scroll" | "click" | "type" | "back" | "read";
	readonly url?: string;
	readonly text?: string;
	readonly selector?: string;
	readonly x?: number;
	readonly y?: number;
};
export type CallShare = {
	readonly tools: {
		readonly share_screen: (url: string) => Promise<string>;
		readonly drive_screen: (action: DriveAction) => Promise<string>;
		readonly stop_share: () => Promise<string>;
	};
	/** The call is ending: stop without saying so. */
	readonly stop: () => Promise<void>;
};

/** What sharing needs from the call it is part of. */
export type ShareNeeds = {
	/** The call's room, once connected. */
	readonly room: () => Room;
	/** Publishes frames as the agent's screen share in the room. */
	readonly publish: (
		room: Room,
		frames: AsyncIterable<ScreenFrame>,
		options?: { readonly fps?: number },
	) => Promise<ScreenShare>;
	/** Says a fixed line in the agent's voice, resolving once it has played. */
	readonly say: (line: string) => Promise<unknown>;
	/** The agent joined uninvited: sharing is refused. */
	readonly uninvited: boolean;
	readonly emit: Emit;
};

/** Makes one call's sharing. Built by the share part, used by the call's process. */
export type MakeShare = (needs: ShareNeeds) => CallShare;
