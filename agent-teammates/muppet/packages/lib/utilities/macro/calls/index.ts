/**
 * Macro calls: showing a browser tab in a call, as a screen share. The tab is
 * a Playwright page (see `utilities/browser`), and frames go to the call
 * through the Macro SDK's `publishScreen`.
 *
 *     const { room } = await connectRoom(call);     // @macro-inc/sdk/calls/node
 *     const page = await (await browser.newContext()).newPage();
 *     const started = await shareScreen({ page, url, publish: publishTo(room) });
 *
 * It needs Chromium and ffmpeg on the system: add this directory's flake to
 * the agent's flake, as its comment shows.
 */
import type { Room } from "@livekit/rtc-node";
import type { Publish } from "./share.ts";

export * from "./frames.ts";
export * from "./policy.ts";
export * from "./share.ts";

/**
 * Publishes to a call's room. The SDK's call helpers load LiveKit's native
 * library, so they're imported only when a share starts.
 */
export const publishTo =
	(room: Room): Publish =>
	async (frames, { fps }) => {
		const { publishScreen } = await import("@macro-inc/sdk/calls/node");
		return publishScreen(room, frames, { fps });
	};
