import { expect, test } from "bun:test";
import {
	type AudioChunk,
	type Member,
	observeRoom,
	type Publication,
	type RoomFeed,
	type RoomListener,
} from "../room.ts";

type Track = string;
type Present = Member & {
	readonly publications: readonly Publication<Track>[];
};

const human = (identity: string, name = ""): Member => ({
	identity,
	name,
	kind: 0,
	human: true,
});
const agent = (identity: string): Member => ({
	identity,
	name: identity,
	kind: 4,
	human: false,
});
const microphone = (sid: string, track?: Track): Publication<Track> => ({
	sid,
	audio: true,
	kind: 1,
	source: 2,
	muted: false,
	track,
});
const chunk = (samples: number, mark = 1): AudioChunk => ({
	data: new Int16Array(samples).fill(mark),
	sampleRate: 16000,
	samplesPerChannel: samples,
});

/** A room driven by hand. */
const room = (initial: readonly Present[] = []) => {
	let members = [...initial];
	const listeners: RoomListener<Track>[] = [];
	const tracks = new Map<Track, readonly AudioChunk[]>();
	const ended: Promise<void>[] = [];
	const events: (readonly [string, unknown])[] = [];
	const audio: (readonly [string, number])[] = [];
	const seen: string[] = [];
	let at = 0;
	let disconnects = 0;
	const feed: RoomFeed<Track> = {
		identity: () => "macro|agent@example.com",
		members: () => members,
		listen: (listener) => listeners.push(listener),
		frames: (track) => {
			const done = Promise.withResolvers<void>();
			ended.push(done.promise);
			return (async function* () {
				try {
					yield* tracks.get(track) ?? [];
				} finally {
					done.resolve();
				}
			})();
		},
		disconnect: async () => {
			disconnects++;
		},
	};
	const observed = observeRoom({
		feed,
		emit: (type, data) => events.push([type, data]),
		handlers: {
			joined: (who, name) => seen.push(`joined ${who} (${name})`),
			left: (who) => seen.push(`left ${who}`),
			audio: (who, frame) => audio.push([who, frame.length]),
			trackEnded: (who) => seen.push(`ended ${who}`),
			ownVoice: "agent",
			disconnected: (reason) => seen.push(`disconnected ${reason}`),
		},
		now: () => at,
	});
	const [listener] = listeners;
	if (listener === undefined) throw new Error("the observer never listened");
	return {
		observed,
		listener,
		tracks,
		events,
		types: () => events.map(([type]) => type),
		audio,
		seen,
		setMembers: (next: readonly Present[]) => {
			members = [...next];
		},
		move: (ms: number) => {
			at += ms;
		},
		/** Every track read so far has been read to its end. */
		drained: async () => {
			await Promise.all(ended);
			await Promise.resolve();
		},
		disconnects: () => disconnects,
	};
};

test("people already in the room are reported, and their microphones are read as 20 ms frames", async () => {
	const r = room([
		{
			...human("macro|ann@example.com", "Ann"),
			publications: [microphone("TR1", "t1")],
		},
		{ ...agent("recorder"), publications: [microphone("TR2", "t2")] },
	]);
	// One odd-sized chunk is re-cut into whole frames; the remainder is dropped.
	r.tracks.set("t1", [chunk(320), chunk(700)]);
	r.observed.present("room-1");
	await r.drained();
	expect(r.seen).toEqual([
		"joined macro|ann@example.com (Ann)",
		"ended macro|ann@example.com",
	]);
	expect(r.audio).toEqual([
		["macro|ann@example.com", 320],
		["macro|ann@example.com", 320],
		["macro|ann@example.com", 320],
	]);
	expect(r.types()).toEqual([
		"room.joined",
		"room.participant_present",
		"room.track_subscribed",
		"room.participant_present",
		"room.first_frame",
		"room.stream_ended",
	]);
	expect(r.events[0]).toEqual([
		"room.joined",
		{ room: "room-1", as: "macro|agent@example.com" },
	]);
	expect(r.observed.humans()).toEqual(["macro|ann@example.com"]);
});

test("an agent's audio is never read, and a track is read once however often it is announced", async () => {
	const r = room();
	r.tracks.set("t1", [chunk(320)]);
	r.listener.subscribed(microphone("TR9", "t9"), agent("eve"));
	r.listener.subscribed(microphone("TR1", "t1"), human("a"));
	r.listener.subscribed(microphone("TR1", "t1"), human("a"));
	r.listener.subscribed(
		{ ...microphone("TR3", "t3"), audio: false },
		human("a"),
	);
	await r.drained();
	expect(r.audio).toEqual([["a", 320]]);
	expect(
		r.types().filter((type) => type === "room.track_subscribed").length,
	).toBe(4);
});

test("the agent's own published track is delivered as its voice, for the recording", async () => {
	const r = room();
	r.tracks.set("mine", [chunk(320)]);
	r.listener.ownTrack(microphone("TR0", "mine"));
	await r.drained();
	expect(r.audio).toEqual([["agent", 320]]);
});

test('every track and speaker event is logged, so "can\'t hear me" says which layer', () => {
	const r = room();
	const ann = human("a", "Ann");
	r.listener.joined(ann);
	r.listener.joined(agent("recorder"));
	r.listener.published(microphone("TR1"), ann);
	r.listener.subscriptionFailed("TR1", ann, "codec");
	r.listener.muted("TR1", "a", true);
	r.listener.muted("TR1", "a", false);
	r.listener.unsubscribed("TR1", ann);
	r.listener.speakers(["a"]);
	r.listener.reconnecting();
	r.listener.reconnected();
	r.listener.left(ann);
	r.listener.disconnected("4");
	expect(r.types()).toEqual([
		"room.participant_joined",
		"room.participant_joined",
		"room.track_published",
		"room.track_subscription_failed",
		"room.track_muted",
		"room.track_unmuted",
		"room.track_unsubscribed",
		"room.active_speakers",
		"room.reconnecting",
		"room.reconnected",
		"room.participant_left",
		"room.disconnected",
	]);
	// Only humans reach the handlers; someone without a name goes by their identity.
	expect(r.seen).toEqual(["joined a (Ann)", "left a", "disconnected 4"]);
});

test("the last speaker is the human who was most recently active, never an agent", () => {
	const r = room();
	expect(r.observed.lastSpeaker()).toEqual(["unknown", "Someone"]);
	r.setMembers([
		{ ...human("a", "Ann"), publications: [] },
		{ ...human("b"), publications: [] },
		{ ...agent("eve"), publications: [] },
	]);
	r.move(10);
	r.listener.speakers(["a"]);
	r.move(10);
	r.listener.speakers(["b", "eve"]);
	expect(r.observed.lastSpeaker()).toEqual(["b", "b"]);
	r.move(10);
	r.listener.speakers(["a"]);
	expect(r.observed.lastSpeaker()).toEqual(["a", "Ann"]);
	expect(r.observed.humans()).toEqual(["a", "b"]);
});

test("leaving disconnects the room", async () => {
	const r = room();
	await r.observed.leave();
	expect(r.disconnects()).toBe(1);
});
