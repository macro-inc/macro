import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScreenFrame, ScreenShare } from "@macro-inc/sdk/calls/node";
import { type Browser, chromium as playwright } from "playwright-core";
import { chromium, type Running } from "../../../browser/index.ts";
import { frameBytes, settings } from "../frames.ts";
import { type Publish, type ShareEvent, shareScreen } from "../share.ts";

const available =
	Bun.which("chromium") !== null && Bun.which("ffmpeg") !== null;

/** Stands in for a call: takes frames as `publishScreen` would, and keeps the first few. */
const fakeCall = (wanted: number) => {
	const frames: ScreenFrame[] = [];
	let ended = () => {};
	const stopped = new Promise<void>((resolve) => {
		ended = resolve;
	});
	let enough = () => {};
	const got = new Promise<void>((resolve) => {
		enough = resolve;
	});
	const publish: Publish = async (source) => {
		void (async () => {
			for await (const frame of source) {
				frames.push({ ...frame, data: frame.data.slice() });
				if (frames.length === wanted) enough();
			}
			ended();
		})();
		const share: ScreenShare = { stop: async () => ended(), stopped };
		return share;
	};
	return { frames, got, publish };
};

/** Every page is allowed: these tests load only about:blank and set its content. */
const anything = async () => true;

describe.skipIf(!available)("shareScreen", () => {
	let profile = "";
	let running: Running | undefined;
	let browser: Browser | undefined;

	beforeAll(async () => {
		profile = await mkdtemp(join(tmpdir(), "muppet-share-"));
		running = await chromium({ profile, port: 9412 });
		browser = await playwright.connectOverCDP(running.endpoint);
	});

	afterAll(async () => {
		await browser?.close();
		await running?.stop();
		await rm(profile, { recursive: true, force: true });
	});

	const page = async () => {
		if (browser === undefined) throw new Error("no browser");
		return (await browser.newContext()).newPage();
	};

	test("streams the tab as fixed-size I420 frames into the call", async () => {
		const call = fakeCall(3);
		const tab = await page();
		const started = await shareScreen({
			page: tab,
			url: "about:blank",
			publish: call.publish,
			safe: anything,
		});
		if (!started.ok) throw new Error(started.rule);
		await tab.setContent(
			`<body style="background:#c33"><h1>Shared</h1></body>`,
		);
		await call.got;
		for (const frame of call.frames.slice(0, 3)) {
			expect(frame.format).toBe("I420");
			expect(frame.width).toBe(settings.width);
			expect(frame.data.length).toBe(frameBytes(settings));
		}
		await started.share.stop();
		expect(await started.share.stopped).toBe("stop");
		expect(tab.isClosed()).toBe(true);
	});

	test("reads and types into the page, and refuses blocked URLs", async () => {
		const call = fakeCall(1);
		const tab = await page();
		const started = await shareScreen({
			page: tab,
			url: "about:blank",
			publish: call.publish,
			safe: anything,
		});
		if (!started.ok) throw new Error(started.rule);
		const { share } = started;
		await tab.setContent("<p>Quarterly numbers</p><input id=q>");

		expect(await share.drive({ action: "read" })).toEqual({
			ok: true,
			text: "Quarterly numbers",
		});
		expect(
			await share.drive({ action: "type", selector: "#q", text: "growth" }),
		).toEqual({ ok: true });
		expect(await tab.inputValue("#q")).toBe("growth");
		expect(
			await share.drive({ action: "navigate", url: "http://127.0.0.1/" }),
		).toEqual({ ok: false, rule: "private-host" });
		expect(
			await share.drive({
				action: "navigate",
				url: "https://mail.google.com/",
			}),
		).toEqual({ ok: false, rule: "mail" });
		await share.stop();
	});

	test("ends the share when the page goes somewhere it may not", async () => {
		const call = fakeCall(1);
		const events: ShareEvent[] = [];
		const tab = await page();
		const started = await shareScreen({
			page: tab,
			url: "about:blank",
			publish: call.publish,
			safe: async (url) => url === "about:blank",
			onEvent: (event) => events.push(event),
		});
		if (!started.ok) throw new Error(started.rule);
		await tab.setContent(
			`<input type="password"><a href="https://example.com/">go</a>`,
		);
		expect(
			await started.share.drive({ action: "type", text: "hunter2" }),
		).toEqual({ ok: false, rule: "password-field" });

		await started.share.drive({ action: "click", text: "go" });
		expect(await started.share.stopped).toBe("navigation-blocked");
		expect(events).toContainEqual({
			kind: "blocked",
			url: "https://example.com/",
		});
	});

	test("refuses to start on a page it may not show", async () => {
		const call = fakeCall(1);
		expect(
			await shareScreen({
				page: await page(),
				url: "https://accounts.google.com/",
				publish: call.publish,
			}),
		).toEqual({ ok: false, rule: "account-security" });
	});
});
