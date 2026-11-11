#!/usr/bin/env bun
// macOS desktop QA harness: launches a built Macro.app on a real macOS GUI
// session and checks what can honestly be checked there. Run by the
// `Desktop QA macOS` workflow (.github/workflows/desktop_qa_macos.yml), and
// runnable by hand on a Mac:
//
//   bun apps/web/tests/macos/qa.mjs --app path/to/Macro.app --out /tmp/qa --suite smoke
//
// Writes <out>/summary.json, <out>/junit.xml, <out>/screenshots/*.png and the
// app's own logs. Exits 1 when any check failed. A check is `pass`, `fail` or
// `skip` (could not be attempted; the detail says why). Nothing is faked: a
// runner without a GUI session reports window checks as failed, not passed.
//
// The desktop app on macOS is Chromium (CEF), not WKWebView, and tauri-driver
// does not support macOS, so there is no WebDriver route. The `cdp` check
// instead asks the running app for Chrome DevTools Protocol on a debugging
// port and reports whether the app honours it.
import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
	cpSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
	options: {
		app: { type: "string" },
		out: { type: "string" },
		suite: { type: "string", default: "smoke" },
		ref: { type: "string", default: "" },
		sha: { type: "string", default: "" },
		report: { type: "string", default: "" },
		// Seconds to wait for the first window; the app unpacks and starts Chromium.
		"window-timeout": { type: "string", default: "90" },
		// Seconds the app must stay up after its window appears.
		soak: { type: "string" },
	},
});
if (!args.app || !args.out) {
	console.error("usage: qa.mjs --app <Macro.app> --out <dir> [--suite smoke|full]");
	process.exit(2);
}
if (args.suite !== "smoke" && args.suite !== "full") {
	console.error(`suite must be smoke or full, got ${args.suite}`);
	process.exit(2);
}

const full = args.suite === "full";
const out = args.out;
const shots = join(out, "screenshots");
mkdirSync(shots, { recursive: true });
const soakSeconds = Number(args.soak ?? (full ? 60 : 15));
const windowTimeout = Number(args["window-timeout"]);
const debugPort = 9333;
const startedAt = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (cmd, argv, options = {}) => {
	const r = spawnSync(cmd, argv, { encoding: "utf8", timeout: 60_000, ...options });
	return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const checks = [];
const check = async (name, body) => {
	const t = Date.now();
	let result;
	try {
		result = await body();
	} catch (error) {
		result = { status: "fail", detail: `threw: ${error?.stack ?? error}` };
	}
	checks.push({ name, ms: Date.now() - t, ...result });
	console.log(`[${result.status}] ${name}: ${result.detail ?? ""}`);
};
const pass = (detail) => ({ status: "pass", detail });
const fail = (detail) => ({ status: "fail", detail });
const skip = (detail) => ({ status: "skip", detail });

// ── the bundle ──────────────────────────────────────────────────────────
const app = args.app;
const plist = join(app, "Contents", "Info.plist");
const plistValue = (key) =>
	run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]).stdout.trim();
const executable = existsSync(plist) ? plistValue("CFBundleExecutable") : "";
const binary = join(app, "Contents", "MacOS", executable);
const bundleVersion = existsSync(plist) ? plistValue("CFBundleShortVersionString") : "";

await check("bundle-structure", async () => {
	if (!existsSync(plist)) return fail(`no Info.plist in ${app}`);
	if (!existsSync(binary)) return fail(`CFBundleExecutable ${executable} missing`);
	const frameworks = join(app, "Contents", "Frameworks");
	const names = existsSync(frameworks) ? readdirSync(frameworks) : [];
	const cef = names.some((n) => n.startsWith("Chromium Embedded Framework"));
	const helpers = names.filter((n) => n.endsWith(".app")).length;
	if (!cef) return fail(`no Chromium Embedded Framework in Frameworks: ${names.join(", ")}`);
	return pass(`${executable} ${bundleVersion}; CEF framework, ${helpers} helper apps`);
});

await check("bundle-architecture", async () => {
	const r = run("lipo", ["-archs", binary]);
	return r.stdout.trim().split(/\s+/).includes("arm64")
		? pass(`lipo: ${r.stdout.trim()}`)
		: fail(`lipo -archs: ${r.stdout.trim()} ${r.stderr.trim()}`);
});

await check("bundle-codesign", async () => {
	const r = run("codesign", ["--verify", "--deep", "--strict", app]);
	return r.code === 0
		? pass("codesign --verify --deep --strict")
		: fail(`${r.stderr.trim().slice(0, 400)}`);
});

// ── launch ──────────────────────────────────────────────────────────────
// A clean HOME: the app creates its data directories as a first-time user.
const home = join(tmpdir(), `macro-qa-home-${process.pid}`);
mkdirSync(home, { recursive: true });
const realHome = homedir();
const appLog = join(out, "app.log");
writeFileSync(appLog, "");
const launchedAt = Date.now();

const child = spawn(binary, [`--remote-debugging-port=${debugPort}`], {
	env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home },
	stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => appendFileSync(appLog, d));
child.stderr.on("data", (d) => appendFileSync(appLog, d));
let exit; // { code, signal } once the app has ended
child.on("exit", (code, signal) => {
	exit = { code, signal, after: Date.now() - launchedAt };
});

const osascript = (script) => run("osascript", ["-e", script]);
const windowsOf = () => {
	const r = osascript(
		`tell application "System Events" to get name of every window of (every process whose unix id is ${child.pid})`,
	);
	return r.code === 0 ? r.stdout.trim() : undefined;
};

let windowTitle;
await check("window-appears", async () => {
	const deadline = Date.now() + windowTimeout * 1000;
	let last = "";
	while (Date.now() < deadline) {
		if (exit) return fail(`app exited (${JSON.stringify(exit)}) before showing a window`);
		const w = windowsOf();
		last = w ?? last;
		// AppleScript prints "title" or "{...}" lists; any non-empty name counts.
		if (w !== undefined && w.replace(/[{},\s]/g, "") !== "") {
			windowTitle = w;
			return pass(`window after ${((Date.now() - launchedAt) / 1000).toFixed(1)}s: ${w}`);
		}
		await sleep(2000);
	}
	const gui = run("osascript", ["-e", 'tell application "System Events" to get name of every process whose background only is false']);
	return fail(
		`no window within ${windowTimeout}s (last: ${JSON.stringify(last)}); System Events: ${gui.code === 0 ? gui.stdout.trim().slice(0, 300) : gui.stderr.trim().slice(0, 300)}`,
	);
});

await check("screenshot", async () => {
	// Let Chromium paint its first frame.
	await sleep(8000);
	const file = join(shots, "app-launch.png");
	const r = run("screencapture", ["-x", file]);
	if (r.code !== 0 || !existsSync(file))
		return fail(`screencapture exit ${r.code}: ${r.stderr.trim()}`);
	const bytes = statSync(file).size;
	// An all-black or empty framebuffer compresses to almost nothing.
	return bytes > 20_000
		? pass(`${bytes} bytes → screenshots/app-launch.png`)
		: fail(`screenshot is ${bytes} bytes: probably a blank display`);
});

await check("menu-bar", async () => {
	const r = osascript(
		`tell application "System Events" to get name of every menu bar item of menu bar 1 of (first process whose unix id is ${child.pid})`,
	);
	if (r.code !== 0) return fail(`System Events: ${r.stderr.trim().slice(0, 300)}`);
	const items = r.stdout.trim();
	return items === "" ? fail("menu bar has no items") : pass(items);
});

if (full) {
	await check("cdp", async () => {
		let version;
		for (let i = 0; i < 5 && !version; i++) {
			try {
				const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
					signal: AbortSignal.timeout(3000),
				});
				version = await r.json();
			} catch {
				await sleep(2000);
			}
		}
		if (!version)
			return skip(
				`the app does not serve DevTools on :${debugPort} with --remote-debugging-port: no UI automation route`,
			);
		const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
		const page = targets.find((t) => t.type === "page");
		if (!page) return fail(`DevTools up (${version.Browser}) but no page target`);
		const state = await evaluate(page.webSocketDebuggerUrl, "document.readyState + '|' + document.title + '|' + location.href");
		return pass(`${version.Browser}; page ${state}`);
	});
}

// Evaluates one expression in a page over the DevTools websocket.
const evaluate = (url, expression) =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const timer = setTimeout(() => reject(new Error("devtools evaluate timed out")), 10_000);
		socket.onopen = () =>
			socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== 1) return;
			clearTimeout(timer);
			socket.close();
			resolve(String(message.result?.result?.value ?? JSON.stringify(message)));
		};
		socket.onerror = () => reject(new Error("devtools websocket error"));
	});

await check("stays-up", async () => {
	const until = Date.now() + soakSeconds * 1000;
	while (Date.now() < until && !exit) await sleep(1000);
	run("screencapture", ["-x", join(shots, "app-after-soak.png")]);
	return exit
		? fail(`app exited after ${(exit.after / 1000).toFixed(1)}s: code ${exit.code}, signal ${exit.signal}`)
		: pass(`still running ${soakSeconds}s after the window appeared`);
});

// ── quit, then look for crashes ─────────────────────────────────────────
if (!exit) {
	child.kill("SIGTERM");
	for (let i = 0; i < 15 && !exit; i++) await sleep(1000);
	if (!exit) child.kill("SIGKILL");
}
await sleep(3000);

await check("no-crash-report", async () => {
	const reports = join(realHome, "Library", "Logs", "DiagnosticReports");
	const fresh = existsSync(reports)
		? readdirSync(reports).filter(
				(n) =>
					/\.(ips|crash)$/.test(n) &&
					n.toLowerCase().includes(basename(executable).toLowerCase()) &&
					statSync(join(reports, n)).mtimeMs >= launchedAt,
			)
		: [];
	for (const name of fresh) cpSync(join(reports, name), join(out, name));
	return fresh.length === 0 ? pass("no crash report since launch") : fail(`crash report(s): ${fresh.join(", ")}`);
});

await check("clean-shutdown", async () => {
	if (!exit) return fail("app did not exit after SIGKILL");
	// SIGTERM ends a Chromium app with a signal; a crash would be SIGSEGV/SIGABRT/SIGILL.
	const crashSignals = ["SIGSEGV", "SIGABRT", "SIGILL", "SIGBUS", "SIGTRAP"];
	return crashSignals.includes(exit.signal)
		? fail(`died of ${exit.signal}`)
		: pass(`exit code ${exit.code}, signal ${exit.signal}`);
});

await check("app-log", async () => {
	const lines = readFileSync(appLog, "utf8").split("\n").filter(Boolean);
	const bad = lines.filter((l) => /\b(panic|panicked|fatal)\b/i.test(l));
	return bad.length === 0
		? pass(`${lines.length} lines on stdout/stderr, none with panic/fatal`)
		: fail(`${bad.length} panic/fatal lines, first: ${bad[0].slice(0, 300)}`);
});

// What the app wrote to the clean HOME (its own logs, data directories).
const homeLogs = join(out, "app-home");
for (const sub of ["Library/Logs", "Library/Application Support"]) {
	const from = join(home, sub);
	if (existsSync(from)) cpSync(from, join(homeLogs, sub), { recursive: true });
}
const unified = run("log", ["show", "--last", "10m", "--style", "compact", "--predicate", `process CONTAINS[c] "${basename(executable)}"`], { timeout: 120_000 });
writeFileSync(join(out, "unified-log.txt"), unified.stdout.slice(-2_000_000));

// ── cargo test, run by the workflow before this ─────────────────────────
const cargoStatus = join(out, "cargo-test.status");
if (full) {
	await check("cargo-test", async () => {
		if (!existsSync(cargoStatus)) return skip("cargo test was not run");
		const status = readFileSync(cargoStatus, "utf8").trim();
		return status === "0" ? pass("cargo test (src-tauri) passed; log in cargo-test.log") : fail(`cargo test exit ${status}; log in cargo-test.log`);
	});
}

// ── summary ─────────────────────────────────────────────────────────────
const count = (s) => checks.filter((c) => c.status === s).length;
const sw = run("sw_vers", ["-productVersion"]).stdout.trim();
const summary = {
	schema: "desktop-qa-macos/1",
	ref: args.ref,
	sha: args.sha,
	suite: args.suite,
	report: args.report || null,
	runner: { os: `macOS ${sw}`, arch: run("uname", ["-m"]).stdout.trim() },
	app: { name: executable, version: bundleVersion },
	durationMs: Date.now() - startedAt,
	passed: count("pass"),
	failed: count("fail"),
	skipped: count("skip"),
	verdict: count("fail") === 0 ? "passed" : "failed",
	checks,
	screenshots: existsSync(shots) ? readdirSync(shots).map((n) => `screenshots/${n}`) : [],
};
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
writeFileSync(
	join(out, "junit.xml"),
	`<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="desktop-qa-macos ${args.suite}" tests="${checks.length}" failures="${count("fail")}" skipped="${count("skip")}" time="${(summary.durationMs / 1000).toFixed(1)}">\n${checks
		.map(
			(c) =>
				`<testcase classname="macos" name="${esc(c.name)}" time="${(c.ms / 1000).toFixed(2)}">${c.status === "fail" ? `<failure message="${esc(c.detail)}"/>` : c.status === "skip" ? `<skipped message="${esc(c.detail)}"/>` : ""}</testcase>`,
		)
		.join("\n")}\n</testsuite>\n`,
);

const icon = { pass: "✅", fail: "❌", skip: "⏭️" };
const markdown = [
	`## macOS QA — ${summary.verdict} (${args.suite})`,
	"",
	`ref \`${args.ref}\` @ \`${args.sha.slice(0, 12)}\`${args.report ? ` · report \`${args.report}\`` : ""} · ${summary.runner.os} ${summary.runner.arch} · ${summary.app.name} ${summary.app.version}`,
	"",
	"| | check | detail |",
	"|---|---|---|",
	...checks.map((c) => `| ${icon[c.status]} | ${c.name} | ${String(c.detail ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 300)} |`),
	"",
	`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped in ${(summary.durationMs / 1000).toFixed(0)}s. Screenshots, logs and \`summary.json\` are in the \`macos-qa-*\` artifact.`,
].join("\n");
writeFileSync(join(out, "summary.md"), `${markdown}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);

process.exit(summary.failed === 0 ? 0 : 1);
