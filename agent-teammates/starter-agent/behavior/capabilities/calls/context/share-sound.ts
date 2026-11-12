/**
 * The clean browser's sound in a call: `parec` records the share browser's
 * sink, and its PCM goes into a LiveKit source published as the agent's
 * screen-share audio. Its voice is another track, and a participant never
 * hears its own, so this never reaches its ears. Loaded only on a call: it brings in
 * LiveKit's native library.
 */
import {
	AudioFrame,
	AudioSource,
	LocalAudioTrack,
	type Room,
	TrackPublishOptions,
	TrackSource,
} from "@livekit/rtc-node";
import type { ScreenConfig } from "../../screen/config.ts";
import { cleanEnv, cutFrames, recordArgv } from "../../screen/screen.ts";
import type { Sounding } from "../share.ts";

const trackName = "screen-share-audio";
/** What parec buffers before it writes. Lower costs wakeups, higher costs lip sync. */
const latencyMs = 20;
/** LiveKit takes 10 ms frames. */
const framesPerSecond = 100;
/** What the source holds before `captureFrame` waits: enough to ride out a busy loop. */
const queueMs = 200;
const bytesPerSample = 2;

export const recordSound =
	(screen: ScreenConfig) =>
	async (room: Room): Promise<Sounding> => {
		if (room.localParticipant === undefined)
			throw new Error("the room isn't connected");
		const { rate, channels } = screen.sound;
		const perChannel = rate / framesPerSecond;
		// The recorder first: one that can't start must not leave a silent track in the room.
		const recorder = Bun.spawn([...recordArgv(screen, latencyMs)], {
			env: cleanEnv(process.env, screen.display),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const source = new AudioSource(rate, channels, queueMs);
		const options = new TrackPublishOptions();
		options.source = TrackSource.SOURCE_SCREENSHARE_AUDIO;
		const publication = await room.localParticipant
			.publishTrack(
				LocalAudioTrack.createAudioTrack(trackName, source),
				options,
			)
			.catch(async (error: unknown) => {
				recorder.kill();
				await source.close().catch(() => {});
				throw error;
			});
		const state = { stopped: false };
		const pumped = (async () => {
			for await (const bytes of cutFrames(
				recorder.stdout,
				perChannel * channels * bytesPerSample,
			)) {
				if (state.stopped) break;
				// The cut buffer is reused; the frame gets its own copy.
				await source.captureFrame(
					new AudioFrame(
						new Int16Array(bytes.slice().buffer),
						rate,
						channels,
						perChannel,
					),
				);
			}
		})().catch(() => {});
		return {
			stop: async () => {
				if (state.stopped) return;
				state.stopped = true;
				recorder.kill();
				await pumped;
				const sid = publication.sid;
				await Promise.allSettled([
					sid === undefined
						? Promise.resolve()
						: room.localParticipant?.unpublishTrack(sid),
				]);
				await source.close().catch(() => {});
			},
		};
	};
