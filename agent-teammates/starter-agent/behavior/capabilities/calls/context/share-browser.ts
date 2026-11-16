/**
 * The tab a share shows, driven over CDP. Every check on what it may load
 * is made here at the wire, before a page renders:
 *
 * - `Fetch.enable` pauses every Document request. A blocked page, or a
 *   redirect into one, is failed before it shows, and the share stops. A
 *   blocked iframe just doesn't load: a login widget on a normal page
 *   shouldn't end the share.
 * - `frameNavigated` and `navigatedWithinDocument` check again, for what
 *   never made a request (history, a single-page app's routes).
 * - If a check can't run, the share stops.
 *
 * Screencast, not x11grab: a new context opens its own window, and x11grab
 * shows whatever's on top. Screencast is the one tab by construction.
 */
import { z } from "zod";
import { type Cdp, connectBrowser } from "../../screen/context/cdp.ts";
import type { ShareBrowser } from "../share.ts";
import { shareSettings } from "../share.ts";
import { blankPage, urlRule } from "../share-policy.ts";
import type { DriveAction } from "../types.ts";

const Context = z.object({ browserContextId: z.string() });
const Target = z.object({ targetId: z.string() });
const Session = z.object({ sessionId: z.string() });
const FrameTree = z.object({
	frameTree: z.object({ frame: z.object({ id: z.string() }) }),
});
const History = z.object({
	currentIndex: z.number(),
	entries: z.array(z.object({ id: z.number() })),
});
const World = z.object({ executionContextId: z.number() });
const Evaluated = z.object({
	result: z.object({ value: z.unknown().optional() }).optional(),
	exceptionDetails: z
		.object({
			text: z.string().optional(),
			exception: z.object({ description: z.string().optional() }).optional(),
		})
		.optional(),
});

const Paused = z.object({
	requestId: z.string(),
	frameId: z.string(),
	resourceType: z.string(),
	request: z.object({ url: z.string() }),
});
const WithinDocument = z.object({ frameId: z.string(), url: z.string() });
const Navigated = z.object({
	frame: z.object({ parentId: z.string().optional(), url: z.string() }),
});
const ScreencastFrame = z.object({ data: z.string(), sessionId: z.number() });
const Created = z.object({
	targetInfo: z.object({
		targetId: z.string(),
		openerId: z.string().optional(),
	}),
});

const documentType = "Document";
const worldName = "agent-share";
const mostPageText = 4096;
/** Where a scroll happens, and how far, when the brain doesn't say. */
const scrollAt = { x: 600, y: 400, distance: 500 } as const;

/** Runs in the page. Never types into, or on a page with, a password field: what the agent types is on everyone's screen. */
const typeScript = (selector: string | undefined, text: string): string =>
	`(() => { if (document.querySelector('input[type=password],iframe') || [...document.querySelectorAll('*')].some(x => x.shadowRoot?.querySelector('input[type=password]'))) throw Error('password-field'); const e = ${JSON.stringify(selector)} ? document.querySelector(${JSON.stringify(selector)}) : document.activeElement; if (!e || e.type === 'password') throw Error('password-field'); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input',{bubbles:true})); return ''; })()`;

const clickScript = (selector: string | undefined, text: string): string =>
	`(() => { const e = ${JSON.stringify(selector)} ? document.querySelector(${JSON.stringify(selector)}) : [...document.querySelectorAll('a,button,[role=button]')].find(x => x.innerText?.trim() === ${JSON.stringify(text)}); if (!e) throw Error('not-found'); e.click(); return ''; })()`;

const readScript = `(document.body?.innerText ?? "").slice(0,${mostPageText})`;

/**
 * Opens the tab of one share on the browser at `port`, in a browser context
 * of its own, disposed with the share: nothing persists, nothing is signed
 * in.
 */
export const openBrowser = async ({
	port,
	safe,
}: {
	readonly port: number;
	/** Whether a URL may be loaded, by rule and by what its name resolves to. */
	readonly safe: (url: string) => Promise<boolean>;
}): Promise<ShareBrowser> => {
	const cdp: Cdp = await connectBrowser(port);
	const opened: { context?: string; target?: string } = {};
	const handlers: {
		allow: (url: string) => Promise<boolean>;
		frame: (jpeg: ArrayBuffer) => void;
		fail: (reason: string) => void;
	} = { allow: async () => false, frame: () => {}, fail: () => {} };

	const dispose = async (): Promise<void> => {
		try {
			if (opened.target !== undefined)
				await cdp.send("Target.closeTarget", { targetId: opened.target });
		} finally {
			if (opened.context !== undefined)
				await cdp
					.send("Target.disposeBrowserContext", {
						browserContextId: opened.context,
					})
					.catch(() => {});
			cdp.close();
		}
	};

	/** An event's handler: if its payload can't be read or its check can't run, the share fails. */
	const on = <Params>(
		event: string,
		schema: z.ZodType<Params>,
		failure: string,
		handle: (params: Params) => Promise<unknown> | undefined,
	): void =>
		cdp.on(event, (raw) => {
			void (async () => handle(schema.parse(raw)))().catch(() =>
				handlers.fail(failure),
			);
		});

	try {
		const context = Context.parse(
			await cdp.send("Target.createBrowserContext", {
				disposeOnDetach: true,
			}),
		).browserContextId;
		opened.context = context;
		const target = Target.parse(
			await cdp.send("Target.createTarget", {
				url: blankPage,
				browserContextId: context,
			}),
		).targetId;
		opened.target = target;
		const session = Session.parse(
			await cdp.send("Target.attachToTarget", {
				targetId: target,
				flatten: true,
			}),
		).sessionId;
		const send = (method: string, params: object = {}): Promise<unknown> =>
			cdp.send(method, params, session);
		const frames: { main?: string } = {};

		on(
			"Fetch.requestPaused",
			Paused,
			"navigation-check-failed",
			async (paused) => {
				const { url } = paused.request;
				const main =
					frames.main === undefined || paused.frameId === frames.main;
				const allowed =
					paused.resourceType === documentType &&
					(await safe(url)) &&
					(!main || (await handlers.allow(url)));
				// A clean context grants nothing to any origin it visits: no camera, no location, no notifications.
				if (context !== undefined && allowed && url !== blankPage)
					await cdp.send("Browser.grantPermissions", {
						permissions: [],
						origin: new URL(url).origin,
						browserContextId: context,
					});
				await send(
					allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
					allowed
						? { requestId: paused.requestId }
						: { requestId: paused.requestId, errorReason: "BlockedByClient" },
				);
				// A blocked iframe (a login widget, say) just doesn't load. A blocked page ends the share.
				if (!allowed && main) handlers.fail("navigation-blocked");
			},
		);
		on(
			"Page.navigatedWithinDocument",
			WithinDocument,
			"navigation-check-failed",
			async ({ frameId, url }) => {
				if (frameId === frames.main && !urlRule(url).ok)
					handlers.fail("navigation-blocked");
			},
		);
		on(
			"Page.frameNavigated",
			Navigated,
			"navigation-check-failed",
			async ({ frame }) => {
				if (frame.parentId !== undefined) return;
				if (!(await safe(frame.url)) || !(await handlers.allow(frame.url)))
					handlers.fail("navigation-blocked");
			},
		);
		// A static page sends one frame and no more, so everyNthFrame would skip it
		// forever (0 frames on example.com). The rate comes from the ack: Chromium
		// sends the next only after it.
		on(
			"Page.screencastFrame",
			ScreencastFrame,
			"capture-failed",
			async ({ data, sessionId }) => {
				handlers.frame(Uint8Array.fromBase64(data).buffer);
				setTimeout(
					() =>
						void send("Page.screencastFrameAck", { sessionId }).catch(() =>
							handlers.fail("capture-failed"),
						),
					1000 / shareSettings.fps,
				);
			},
		);
		on("Page.javascriptDialogOpening", z.unknown(), "prompt-failed", () =>
			send("Page.handleJavaScriptDialog", { accept: false }),
		);
		on(
			"Target.targetCreated",
			Created,
			"popup-failed",
			async ({ targetInfo }) => {
				if (targetInfo.openerId === target)
					await cdp.send("Target.closeTarget", {
						targetId: targetInfo.targetId,
					});
			},
		);

		await cdp.send("Target.setDiscoverTargets", { discover: true });
		await send("Page.enable");
		const mainFrame = async (): Promise<string> =>
			FrameTree.parse(await send("Page.getFrameTree")).frameTree.frame.id;
		frames.main = await mainFrame();
		await send("Fetch.enable", {
			patterns: [
				{
					urlPattern: "*",
					resourceType: documentType,
					requestStage: "Request",
				},
			],
		});
		{
			await cdp.send("Browser.setDownloadBehavior", {
				behavior: "deny",
				browserContextId: context,
			});
			await cdp.send("Browser.grantPermissions", {
				permissions: [],
				browserContextId: context,
			});
		}
		await send("Page.bringToFront");

		const evaluate = async (expression: string): Promise<string> => {
			// In a world of its own, so the page's scripts can't see or change what runs.
			const world = World.parse(
				await send("Page.createIsolatedWorld", {
					frameId: await mainFrame(),
					worldName,
				}),
			);
			const evaluated = Evaluated.parse(
				await send("Runtime.evaluate", {
					expression,
					contextId: world.executionContextId,
					returnByValue: true,
					awaitPromise: true,
				}),
			);
			const thrown = evaluated.exceptionDetails;
			if (thrown !== undefined)
				throw new Error(thrown.exception?.description ?? thrown.text ?? "");
			const value = evaluated.result?.value;
			return typeof value === "string" ? value : "";
		};

		const drive = async (action: DriveAction): Promise<string> => {
			switch (action.action) {
				case "back": {
					const history = History.parse(
						await send("Page.getNavigationHistory"),
					);
					const before = history.entries[history.currentIndex - 1];
					if (before === undefined) throw new Error("no-history");
					await send("Page.navigateToHistoryEntry", { entryId: before.id });
					return "";
				}
				case "navigate":
					await send("Page.navigate", { url: action.url });
					return "";
				case "scroll":
					await send("Input.synthesizeScrollGesture", {
						x: action.x ?? scrollAt.x,
						y: action.y ?? scrollAt.y,
						yDistance: action.y ?? scrollAt.distance,
					});
					return "";
				case "read":
					return evaluate(readScript);
				case "type":
					return evaluate(typeScript(action.selector, action.text ?? ""));
				case "click":
					return evaluate(clickScript(action.selector, action.text ?? ""));
			}
		};

		return {
			onNavigation: (allow) => {
				handlers.allow = allow;
			},
			onFrame: async (take) => {
				handlers.frame = take;
				await send("Page.startScreencast", {
					format: "jpeg",
					quality: shareSettings.quality,
					maxWidth: shareSettings.width,
					maxHeight: shareSettings.height,
					everyNthFrame: 1,
				});
			},
			onFailure: (failed) => {
				handlers.fail = failed;
			},
			navigate: async (url) => {
				await send("Page.navigate", { url });
			},
			drive,
			close: dispose,
		};
	} catch (error) {
		await dispose().catch(() => {});
		throw error;
	}
};
