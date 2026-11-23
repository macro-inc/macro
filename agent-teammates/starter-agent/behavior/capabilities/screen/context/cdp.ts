/**
 * The Chrome DevTools Protocol, as little of it as driving a browser needs:
 * one socket, commands answered by id, events by name. What comes back is
 * `unknown`; whoever asked parses it.
 */
import { z } from "zod";
import { cdpAddress } from "../config.ts";

export type Cdp = {
	/** Sends a command, to a target's session if one is given, and resolves with its result. */
	readonly send: (
		method: string,
		params?: object,
		sessionId?: string,
	) => Promise<unknown>;
	/** Calls `listener` with the params of every event by this name. */
	readonly on: (event: string, listener: (params: unknown) => void) => void;
	readonly close: () => void;
};

const Message = z.object({
	id: z.number().optional(),
	method: z.string().optional(),
	params: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.object({ message: z.string() }).optional(),
});

const text = (data: unknown): string => (typeof data === "string" ? data : "");

/** Connects to a DevTools socket: the browser's, or one tab's. */
export const connectCdp = (url: string): Promise<Cdp> =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const pending = new Map<
			number,
			{
				readonly resolve: (result: unknown) => void;
				readonly reject: (error: Error) => void;
			}
		>();
		const listeners = new Map<string, ((params: unknown) => void)[]>();
		let last = 0;
		let closed = false;
		socket.addEventListener("message", ({ data }) => {
			let parsed: z.infer<typeof Message>;
			try {
				parsed = Message.parse(JSON.parse(text(data)));
			} catch {
				return;
			}
			if (parsed.id !== undefined) {
				const waiting = pending.get(parsed.id);
				pending.delete(parsed.id);
				if (parsed.error !== undefined)
					waiting?.reject(new Error(parsed.error.message));
				else waiting?.resolve(parsed.result);
				return;
			}
			if (parsed.method === undefined) return;
			for (const listener of listeners.get(parsed.method) ?? [])
				listener(parsed.params);
		});
		socket.addEventListener("close", () => {
			closed = true;
			for (const waiting of pending.values())
				waiting.reject(new Error("CDP closed"));
			pending.clear();
		});
		socket.addEventListener("error", () =>
			reject(new Error(`CDP unavailable at ${url}`)),
		);
		socket.addEventListener("open", () =>
			resolve({
				send: (method, params = {}, sessionId) =>
					new Promise((done, failed) => {
						if (closed) {
							failed(new Error("CDP closed"));
							return;
						}
						const id = ++last;
						pending.set(id, { resolve: done, reject: failed });
						socket.send(JSON.stringify({ id, method, params, sessionId }));
					}),
				on: (event, listener) => {
					listeners.set(event, [...(listeners.get(event) ?? []), listener]);
				},
				close: () => socket.close(),
			}),
		);
	});

/** JSON from a browser's DevTools HTTP address, on loopback. */
export const cdpJson = async (
	port: number,
	path: string,
	method: "GET" | "PUT" = "GET",
): Promise<unknown> => {
	const response = await fetch(`${cdpAddress(port)}${path}`, { method });
	if (!response.ok) throw new Error(`CDP ${path}: ${response.status}`);
	return response.json();
};

const versionPath = "/json/version";
const newTabPath = "/json/new?about:blank";
const closeTabPath = "/json/close/";

const Socket = z.object({ webSocketDebuggerUrl: z.string() });
const NewTab = Socket.extend({ id: z.string() });

/** Connects to the browser listening on a port, as a whole: targets, contexts and every tab's session. */
export const connectBrowser = async (port: number): Promise<Cdp> =>
	connectCdp(
		Socket.parse(await cdpJson(port, versionPath)).webSocketDebuggerUrl,
	);

/** Opens a tab in front, on a page, and connects to it alone. */
export const openTab = async (
	port: number,
	url: string,
): Promise<Pick<Cdp, "send"> & { readonly close: () => Promise<void> }> => {
	const tab = NewTab.parse(await cdpJson(port, newTabPath, "PUT"));
	const cdp = await connectCdp(tab.webSocketDebuggerUrl);
	await cdp.send("Page.enable");
	// The front tab is what the display shows.
	await cdp.send("Page.bringToFront");
	await cdp.send("Page.navigate", { url });
	return {
		send: cdp.send,
		close: async () => {
			cdp.close();
			await fetch(`${cdpAddress(port)}${closeTabPath}${tab.id}`);
		},
	};
};
