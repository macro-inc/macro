/**
 * Macro's calls, behind a small port, so everything that decides about calls
 * can be run against a fake. `sdkCalls` is the thin adapter over the
 * supported SDK surface (`@macro-inc/sdk`, and `@macro-inc/sdk/calls/node`
 * for the room): `calls.byId(id).join()` can't create a call, and
 * `channel.startCall()` is only for a call the agent is placing.
 */
import type { Room } from "@livekit/rtc-node";
import type { Macro } from "@macro-inc/sdk";
import type {
	connectRoom,
	publishScreen,
	ScreenFrame,
	ScreenShare,
} from "@macro-inc/sdk/calls/node";
import {
	type ActiveCall,
	type ActiveMeeting,
	type ChannelMessage,
	type JoinKind,
	Refusal,
} from "./types.ts";

/** A seat in a call. The room credential stays inside it: nothing here can log or store a token. */
export type Connection = {
	readonly callId: string;
	/** The RTC room's name. */
	readonly room: string;
	/** Whether this request created the call, which is what rings people. */
	readonly started: boolean;
	/** Connects a LiveKit room with this seat, as Macro's app does (DTX off). */
	readonly connect: () => Promise<Room>;
	/** Leaves this exact call. Safe to call twice: Macro's 404 for the second is swallowed. */
	readonly leave: () => Promise<void>;
};

export type JoinRequest = {
	readonly kind: JoinKind;
	/** The channel's id, or the meeting's invitation token. */
	readonly id: string;
	/** The live call to join. A join by id can't start a call. */
	readonly callId?: string;
	/** The agent is placing this call: start it in the channel, which rings its members. */
	readonly placed?: boolean;
	/** `fail` unless the arbiter decided otherwise: a token request must never evict the agent from another call by accident. */
	readonly onOtherCall?: "fail" | "switch";
	/** Disconnect a connection this identity already has. Only when no join of its own is alive: replacing a live one ends the call. */
	readonly replace?: boolean;
};

export type MessageFacts = {
	readonly author: string;
	/** The author's display name, or their id. */
	readonly name: string;
	readonly text: string;
	readonly at: Temporal.Instant;
	/** Whether it was posted in a DM. */
	readonly dm: boolean;
};

export type CallApi = {
	/** Whose account this is. */
	readonly me: () => Promise<string>;
	/** One attempt at a seat; `retry` adds the deadline and the retries. Throws what Macro said; `refusal` reads it. */
	readonly join: (request: JoinRequest) => Promise<Connection>;
	/** Live calls in channels this account is in. */
	readonly activeCalls: () => Promise<readonly ActiveCall[]>;
	/** Live meetings this account made, was in, or is invited to. */
	readonly meetings: () => Promise<readonly ActiveMeeting[]>;
	/** Whether a channel is a DM, and its name: empty if it failed to load. */
	readonly channel: (
		id: string,
	) => Promise<{ readonly dm: boolean; readonly name: string }>;
	/** The channel's live call, read without joining it. */
	readonly liveCall: (channelId: string) => Promise<string | null>;
	/** Who's in a meeting, by display name, read without joining it. */
	readonly attendees: (token: string) => Promise<readonly string[]>;
	/** Up to 100 of a channel's messages since an instant, oldest first. */
	readonly messagesSince: (
		channelId: string,
		since: Temporal.Instant,
	) => Promise<readonly ChannelMessage[]>;
	/** Macro's own record of a message: the only thing that says who wrote it. */
	readonly message: (channelId: string, id: string) => Promise<MessageFacts>;
	/** The Macro ids of a channel's members. */
	readonly members: (channelId: string) => Promise<readonly string[]>;
	/** The DM channel with a user, opened if needed. Opening one is itself contact. */
	readonly dmChannel: (userId: string) => Promise<string>;
	/**
	 * Posts in the chat sidebar of a call: a channel call's thread in its
	 * channel, or a meeting's own call chat. What the sidebar shows is the
	 * call's discussion, so that's where it goes.
	 */
	readonly postChat: (callId: string, text: string) => Promise<void>;
	/** Publishes frames as this account's screen share in a room. */
	readonly publishScreen: (
		room: Room,
		frames: AsyncIterable<ScreenFrame>,
		options?: { readonly fps?: number },
	) => Promise<ScreenShare>;
	/**
	 * Calls `changed` whenever Macro says something about a call changed, and
	 * `up` as the stream comes and goes. Best effort: events are missed while
	 * the stream is down, so the watcher still polls. Returns the stop.
	 */
	readonly watch: (listener: {
		readonly changed: () => void;
		readonly up: (up: boolean) => void;
	}) => Promise<() => void>;
};

const directMessage = "direct_message";
const gone = 410;
const notFound = 404;
const mostMessages = 100;
const callEvents = [
	"call.started",
	"call.ended",
	"call.ringing",
	"call.invited",
	"call.participant_left",
] as const;

const field = (error: unknown, name: "name" | "status"): unknown =>
	typeof error === "object" && error !== null && name in error
		? Reflect.get(error, name)
		: undefined;

/**
 * What Macro's refusal to seat the agent means, by the error's name and status.
 * Null for anything else (a network failure, a timeout), which is worth
 * another try.
 */
export const refusal = (error: unknown): Refusal | null => {
	const name = field(error, "name");
	const status = field(error, "status");
	if (name === "InOtherCallError") return "in_other_call";
	if (name === "AlreadyConnectedError") return "already_connected";
	if (name === "CallEndedError" || status === gone) return "ended";
	if (status === 429) return "rate_limited";
	if (status === 403) return "refused";
	// The call routes answer 404 for a user without programmatic calls enabled.
	if (status === notFound) return "flag_off";
	return null;
};

/** The exit code of a join that Macro refused, so the watcher knows why without reading its log. `ended` is a clean exit: the call is over. */
export const refusalExits: Readonly<Record<Refusal, number>> = {
	in_other_call: 76,
	already_connected: 77,
	ended: 0,
	rate_limited: 78,
	refused: 79,
	flag_off: 80,
};

/** The refusal a join's exit code stands for, if any. */
export const refusalOfExit = (code: number): Refusal | undefined =>
	code === 0
		? undefined
		: Refusal.options.find((name) => refusalExits[name] === code);

/** The token at the end of a meeting's link. */
export const tokenOf = (webUrl: string): string =>
	decodeURIComponent(webUrl.split("/").pop() ?? "");

const ended = (): Error =>
	Object.assign(new Error("call ended"), { status: gone });

export const sdkCalls = ({
	macro: connect,
	connectRoom: connectTo,
	publishScreen: publish,
}: {
	readonly macro: () => Promise<Macro>;
	readonly connectRoom: typeof connectRoom;
	readonly publishScreen: typeof publishScreen;
}): CallApi => {
	type Call = Awaited<ReturnType<Macro["calls"]["active"]>>[number];
	type Seat = Awaited<ReturnType<Call["join"]>>;
	type Detail = {
		readonly channelId?: string;
		readonly createdBy: string;
		readonly createdAt: string;
		readonly meeting?: ActiveMeeting;
	};
	const channels = new Map<string, { dm: boolean; name: string }>();
	/** A meeting's call id by its token, learned from the live list. */
	const meetingCalls = new Map<string, string>();
	const details = new Map<string, Promise<Detail>>();
	let listing: Promise<readonly Call[]> | undefined;

	/** The live list, asked for once however many readers want it in the same tick. */
	const active = (): Promise<readonly Call[]> => {
		if (listing !== undefined) return listing;
		const asked = connect().then((macro) => macro.calls.active());
		listing = asked;
		queueMicrotask(() => {
			listing = undefined;
		});
		return asked;
	};

	const detail = (call: Call): Promise<Detail> => {
		const known = details.get(call.id);
		if (known !== undefined) return known;
		const loading = (async (): Promise<Detail> => {
			const [channel, creator, createdAt] = await Promise.all([
				call.channel(),
				call.creator(),
				call.startedAt(),
			]);
			const base = { channelId: channel?.id, createdBy: creator.id, createdAt };
			if (call.kind !== "standalone") return base;
			const meeting = await call.meeting();
			const [title, url] = await Promise.all([
				meeting.title(),
				meeting.webUrl(),
			]);
			const token = tokenOf(url);
			if (token !== "") meetingCalls.set(token, call.id);
			return {
				...base,
				meeting: {
					id: meeting.id,
					callId: call.id,
					title,
					token: token === "" ? null : token,
					createdBy: creator.id,
				},
			};
		})();
		details.set(call.id, loading);
		// A failed read is tried again next time, not remembered.
		loading.catch(() => details.delete(call.id));
		return loading;
	};

	const seat = (seated: Seat): Connection => ({
		callId: seated.call.id,
		room: seated.roomName,
		started: seated.started,
		// The seat is already granted, so the helper's own join just hands it over;
		// the retries and the connect deadline stay ours.
		connect: async () => (await connectTo({ join: async () => seated })).room,
		leave: async () => {
			await seated.leave().catch((error: unknown) => {
				if (field(error, "status") !== notFound) throw error;
			});
		},
	});

	const channelFacts = async (id: string) => {
		const known = channels.get(id);
		if (known !== undefined) return known;
		const channel = (await connect()).channels.byId(id);
		const [type, name] = await Promise.all([
			channel.type().catch(() => undefined),
			channel.name().catch(() => ""),
		]);
		const facts = { dm: type === directMessage, name };
		// A name that failed to load is asked for again, rather than kept empty.
		if (name !== "") channels.set(id, facts);
		return facts;
	};

	return {
		me: async () => (await (await connect()).users.me()).id,
		join: async ({ kind, id, callId, placed, onOtherCall, replace }) => {
			const macro = await connect();
			const options = { onOtherCall: onOtherCall ?? "fail", replace };
			if (placed === true)
				return seat(await macro.channels.byId(id).startCall(options));
			if (callId !== undefined)
				return seat(await macro.calls.byId(callId).join(options));
			if (kind === "meeting")
				return seat(await (await macro.meetings.lookup(id)).join(options));
			const call = await macro.channels.byId(id).activeCall();
			if (call === undefined) throw ended();
			return seat(await call.join(options));
		},
		activeCalls: async () => {
			const calls = await active();
			return Promise.all(
				calls
					.filter(({ kind }) => kind === "channel")
					.map(async (call) => {
						const { channelId, createdBy, createdAt } = await detail(call);
						if (channelId === undefined)
							throw new Error(`channel call ${call.id} has no channel`);
						return { callId: call.id, channelId, createdBy, createdAt };
					}),
			);
		},
		meetings: async () => {
			const calls = await active();
			const found = await Promise.all(
				calls
					.filter(({ kind }) => kind === "standalone")
					.map(async (call) => (await detail(call)).meeting),
			);
			return found.flatMap((meeting) =>
				meeting === undefined ? [] : [meeting],
			);
		},
		channel: channelFacts,
		liveCall: async (channelId) =>
			(await (await connect()).channels.byId(channelId).activeCall())?.id ??
			null,
		attendees: async (token) => {
			const macro = await connect();
			const roster = await macro.calls
				.byId(meetingCalls.get(token) ?? token)
				.participants();
			return roster.map(({ displayName }) => displayName);
		},
		messagesSince: async (channelId, since) => {
			const macro = await connect();
			const found: ChannelMessage[] = [];
			for await (const message of macro.channels
				.byId(channelId)
				.messagesAfter(since.toString())) {
				const author = await message.author();
				found.push({
					id: message.id,
					from: (await author.name().catch(() => undefined)) ?? author.id,
					fromId: author.id,
					at: await message.createdAt(),
					text: await message.content(),
				});
				if (found.length >= mostMessages) break;
			}
			// The SDK gives newest first.
			return found.reverse();
		},
		message: async (channelId, id) => {
			const macro = await connect();
			const message = macro.channels.byId(channelId).message(id);
			const author = await message.author();
			return {
				author: author.id,
				name: (await author.name().catch(() => undefined)) ?? author.id,
				text: await message.content(),
				at: Temporal.Instant.from(await message.createdAt()),
				dm: (await channelFacts(channelId)).dm,
			};
		},
		members: async (channelId) =>
			(await (await connect()).channels.byId(channelId).participants()).map(
				({ user_id }) => user_id,
			),
		dmChannel: async (userId) => {
			const macro = await connect();
			return (await macro.channels.dm(macro.users.byId(userId))).id;
		},
		postChat: async (callId, text) => {
			const call = (await connect()).calls.byId(callId);
			const discussion = await call.discussion();
			await ("reply" in discussion
				? discussion.reply(text)
				: call.message(callId).reply(text));
		},
		publishScreen: (room, frames, options) => publish(room, frames, options),
		watch: async ({ changed, up }) => {
			const macro = await connect();
			const off = callEvents.map((name) => macro.events.on(name, changed));
			// Its own stream, with its own filters: a stream's filters are fixed
			// when it opens, and chat's was opened for messages only.
			const stop = await macro.events.listen({
				filters: [{ events: [...callEvents] }],
			});
			up(true);
			return () => {
				stop();
				for (const unsubscribe of off) unsubscribe();
				up(false);
			};
		},
	};
};
