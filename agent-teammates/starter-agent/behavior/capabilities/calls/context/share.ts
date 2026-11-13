/**
 * Sharing's real ports: the browsers a share can show, the frame feed, and
 * the resolver its checks ask. Built once; every call's sharing is made
 * from them.
 */
import { lookup } from "node:dns/promises";
import type { Base } from "../../../context/index.ts";
import { screenConfig } from "../../screen/config.ts";
import { makeShare, type SharePorts } from "../share.ts";
import { safeUrl } from "../share-policy.ts";
import type { MakeShare } from "../types.ts";
import { openBrowser } from "./share-browser.ts";
import { workerFrames } from "./share-feed.ts";

export const sharePorts = ({ state, join }: Base): SharePorts => {
	const screen = screenConfig({ state, join });
	const safe = safeUrl(async (host) =>
		(await lookup(host, { all: true, verbatim: true })).map(
			({ address }) => address,
		),
	);
	return {
		open: () => openBrowser({ port: screen.cdpPort, safe }),
		frames: () => workerFrames(),
		safe,
		// LiveKit's native library loads with the first share, never in the agent's main process.
		sound: async (room) =>
			(await import("./share-sound.ts")).recordSound(screen)(room),
	};
};

/** Sharing for a call, over the real browsers: what a call's process is handed. */
export const realShare = (base: Base): MakeShare => makeShare(sharePorts(base));

/** What the `share` key of the context holds. */
export type Share = {
	/** Makes one call's sharing from what the call gives it. */
	readonly make: MakeShare;
};

export const shareContext = (base: Base): Share => ({ make: realShare(base) });
