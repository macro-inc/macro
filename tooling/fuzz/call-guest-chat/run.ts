import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { loadCorpus } from "./corpus";

const harness = import.meta.dir;
const branch = resolve(harness, "../../..");
const baseline = process.env.CGC_BASELINE ?? "/tmp/cgc-fuzz-main";
const corpus = loadCorpus(process.env.CGC_CORPUS);
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const port = 3099;
const fixturePath = "apps/web/src/lib/core/messages/browser-test/cgc-diff";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function requestBodyHash(body: string | null) {
  if (!body) return hash("");
  try {
    const normalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === "object") {
        const nonce = (value as Record<string, unknown>).nonce;
        return Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [
              key,
              key === "nonce" || (key === "id" && item === nonce)
                ? "<nonce>"
                : normalize(item),
            ]),
        );
      }
      return value;
    };
    return hash(JSON.stringify(normalize(JSON.parse(body))));
  } catch {
    return hash(body);
  }
}

async function ready(url: string) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local Vite server is still starting.
    }
    await Bun.sleep(500);
  }
  throw new Error("Vite did not become ready");
}

type Result = {
  layout: string;
  cases: Record<string, string>;
  requests: string[];
  errors: string[];
  actions: Record<string, { dom?: string; error?: string; requests: string[] }>;
  controls: Record<string, number>;
};

async function snapshot(page: Page, selector = "main") {
  return page.locator(selector).evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    for (const action of clone.querySelectorAll(
      "[data-message-hover-actions]",
    )) {
      action.remove();
    }
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      element.removeAttribute("class");
      element.removeAttribute("id");
      element.removeAttribute("style");
      for (const attribute of [...element.attributes]) {
        if (
          /^(data-solid|data-scope|aria-controls|aria-owns)/.test(
            attribute.name,
          )
        ) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    return clone.outerHTML.replace(/\s+/g, " ").trim();
  });
}

async function exercise(
  page: Page,
  id: string,
  requests: string[],
  phone: boolean,
  checkout: string,
) {
  const results: Result["actions"] = {};
  const section = page.locator(`[data-case-id="${id}"]`);
  const row = section.locator("[data-message-id]").first();
  const actionSurface = async () => {
    if (!phone) {
      await row.hover({ timeout: 2000 });
      return row;
    }
    await row.evaluate((element) => {
      const touch = new Touch({
        identifier: 1,
        target: element,
        clientX: 20,
        clientY: 20,
      });
      element.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        }),
      );
    });
    const drawer = page.getByRole("dialog", { name: "Message actions" });
    await drawer.waitFor({ timeout: 2000 });
    return drawer;
  };
  const attempt = async (name: string, action: () => Promise<void>) => {
    const before = requests.length;
    try {
      await action();
      await page.waitForTimeout(250);
      const dom = await snapshot(page);
      if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS) {
        writeFileSync(
          `/tmp/cgc-fuzz-action-${checkout}-${phone ? "phone" : "desktop"}-${name}.html`,
          dom,
        );
      }
      results[name] = {
        dom: hash(dom),
        requests: [...new Set(requests.slice(before))].sort(),
      };
    } catch (error) {
      if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS) {
        console.error(name, String(error).slice(0, 2000));
      }
      results[name] = {
        error: `unavailable:${String(error).split("\n")[0]}`,
        requests: [...new Set(requests.slice(before))].sort(),
      };
    }
  };
  await attempt("open-thread", async () => {
    await section.getByTitle("Expand thread").click({ timeout: 2000 });
  });
  await attempt("hover", async () => {
    await actionSurface();
  });
  await attempt("react", async () => {
    const surface = await actionSurface();
    await surface
      .getByRole("button", { name: "React 👍" })
      .click({ timeout: 2000 });
  });
  await attempt("quote", async () => {
    await row
      .locator("[data-message-content]")
      .first()
      .evaluate((content) => {
        const text = document
          .createTreeWalker(content, NodeFilter.SHOW_TEXT)
          .nextNode();
        if (!text?.textContent) return;
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(10, text.textContent.length));
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
    const surface = await actionSurface();
    await surface
      .getByRole("button", { name: "Reply" })
      .click({ timeout: 2000 });
    const input = section.locator(`[data-input-id="thread-reply-input-${id}"]`);
    await input
      .locator("[contenteditable]")
      .fill("Quoted fixture reply", { timeout: 2000 });
    await input
      .getByRole("button", { name: "Send message" })
      .click({ timeout: 2000 });
  });
  await attempt("reply", async () => {
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const surface = await actionSurface();
    await surface
      .getByRole("button", { name: /reply/i })
      .first()
      .click({ timeout: 2000 });
    const input = section.locator(`[data-input-id="thread-reply-input-${id}"]`);
    await input
      .locator("[contenteditable]")
      .fill("Fixture reply", { timeout: 2000 });
    await input
      .getByRole("button", { name: "Send message" })
      .click({ timeout: 2000 });
  });
  await attempt("edit", async () => {
    const surface = await actionSurface();
    await surface
      .getByRole("button", { name: "Edit" })
      .click({ timeout: 2000 });
    const editor = section.locator(
      `[data-input-id="edit-message-input-${id}"]`,
    );
    await editor
      .locator("[contenteditable]")
      .fill("Edited fixture message", { timeout: 2000 });
    await editor
      .getByRole("button", { name: "Send message" })
      .click({ timeout: 2000 });
  });
  await attempt("compose", async () => {
    const input = section.locator(`[data-input-id="composer-${id}"]`);
    await input
      .locator("[contenteditable]")
      .fill("Differential fixture message", {
        timeout: 2000,
      });
    await input
      .getByRole("button", { name: "Send message" })
      .click({ timeout: 2000 });
  });
  await attempt("mention", async () => {
    const input = section.locator(`[data-input-id="composer-${id}"]`);
    await input.locator("[contenteditable]").fill("@fixture-user", {
      timeout: 2000,
    });
    await input
      .getByRole("button", { name: "Send message" })
      .click({ timeout: 2000 });
  });
  await attempt("attachment", async () => {
    await section
      .locator("input[data-collapsed-input-file-picker]")
      .last()
      .setInputFiles({
        name: "fixture.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("fixture"),
      });
  });
  await attempt("delete", async () => {
    const surface = await actionSurface();
    await surface
      .getByRole("button", { name: "Delete" })
      .click({ timeout: 2000 });
    await page
      .getByRole("dialog", { name: /Delete (comment|message)/ })
      .getByRole("button", { name: "Delete" })
      .click({ timeout: 2000 });
  });
  return results;
}

async function run(
  checkout: string,
  browser: Browser,
): Promise<Record<string, Result>> {
  const link = resolve(checkout, fixturePath);
  if (existsSync(link)) throw new Error(`Fixture path already exists: ${link}`);
  mkdirSync(link);
  copyFileSync(resolve(harness, "fixture.html"), resolve(link, "fixture.html"));
  copyFileSync(resolve(harness, "fixture.tsx"), resolve(link, "fixture.tsx"));
  const server = Bun.spawn(
    ["bunx", "vite", "--port", String(port), "--strictPort"],
    {
      cwd: resolve(checkout, "apps/web"),
      env: { ...process.env, MACRO_DEV_HTTPS: "false" },
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  try {
    await ready(`http://localhost:${port}/app/`);
    const results: Record<string, Result> = {};
    for (const phone of [false, true]) {
      const context = await browser.newContext(
        phone
          ? {
              viewport: { width: 390, height: 844 },
              hasTouch: true,
            }
          : { viewport: { width: 1280, height: 860 } },
      );
      const page = await context.newPage();
      const requests: string[] = [];
      const messageRequests: string[] = [];
      const errors: string[] = [];
      const debugRequestsPath = `/tmp/cgc-fuzz-requests-${checkout === baseline ? "baseline" : "branch"}-${phone ? "phone" : "desktop"}.jsonl`;
      if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS)
        writeFileSync(debugRequestsPath, "");
      page.on("pageerror", (error) => {
        errors.push(hash(error.message));
        if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS)
          console.error(error.stack);
      });
      page.on("response", (response) => {
        if (
          process.env.CGC_DEBUG &&
          !process.env.CGC_CORPUS &&
          response.status() >= 400
        ) {
          console.error(response.status(), response.url());
        }
      });
      await page.route("**/__cgc_corpus", (route) =>
        route.fulfill({ json: corpus }),
      );
      await page.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const isViteAsset =
          url.origin === `http://localhost:${port}` &&
          (url.pathname.startsWith("/src/") ||
            url.pathname.startsWith("/@") ||
            url.pathname.startsWith("/node_modules/") ||
            url.pathname.startsWith("/packages/"));
        if (isViteAsset) return route.fallback();
        if (
          request.resourceType() === "fetch" ||
          request.resourceType() === "xhr"
        ) {
          if (url.pathname !== "/__cgc_corpus") {
            if (
              process.env.CGC_DEBUG &&
              !process.env.CGC_CORPUS &&
              request.method() !== "GET"
            ) {
              appendFileSync(
                debugRequestsPath,
                `${JSON.stringify({ method: request.method(), path: url.pathname, body: request.postData() })}\n`,
              );
            }
            const fingerprint = `${request.method()} ${hash(url.pathname)} ${requestBodyHash(request.postData())}`;
            requests.push(fingerprint);
            if (
              request.method() !== "GET" &&
              url.pathname.includes("/messages/")
            )
              messageRequests.push(fingerprint);
            return route.abort();
          }
        }
        if (!request.url().startsWith(`http://localhost:${port}`))
          return route.abort();
        return route.fallback();
      });
      console.error(
        `${checkout === baseline ? "baseline" : "branch"} ${phone ? "phone" : "desktop"}: loading`,
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) {
          requests.length = 0;
          messageRequests.length = 0;
          errors.length = 0;
        }
        await page.goto(
          `http://localhost:${port}/src/lib/core/messages/browser-test/cgc-diff/fixture.html`,
          { waitUntil: "domcontentloaded", timeout: 180000 },
        );
        try {
          await page
            .locator("[data-case-id]")
            .first()
            .waitFor({
              timeout: Number(process.env.CGC_WAIT_MS ?? 60000),
            });
          break;
        } catch (error) {
          const stage = await page.locator("body").getAttribute("data-stage");
          console.error(`Fixture load retry ${attempt + 1}: ${stage}`);
          if (attempt < 2) continue;
          if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS) {
            console.error(await page.locator("body").innerHTML());
          }
          throw error;
        }
      }
      const layout = await snapshot(page);
      if (process.env.CGC_DEBUG && !process.env.CGC_CORPUS) {
        writeFileSync(
          `/tmp/cgc-fuzz-${checkout === baseline ? "baseline" : "branch"}-${phone ? "phone" : "desktop"}.html`,
          layout,
        );
      }
      const cases: Record<string, string> = {};
      for (const thread of corpus.threads) {
        cases[thread.root.id] = hash(
          await snapshot(page, `[data-case-id="${thread.root.id}"]`),
        );
      }
      const controls = {
        attachments: await page
          .getByRole("button", { name: "Attach files" })
          .count(),
        dictation: await page
          .getByRole("button", { name: /dictat|microphone/i })
          .count(),
      };
      const samples = new Map<string, (typeof corpus.threads)[number]>();
      for (const thread of corpus.threads) {
        if (thread.root.deleted_at) continue;
        const kind = corpus.labels?.[thread.root.id] ?? thread.root.parent.type;
        const current = samples.get(kind);
        if (
          !current ||
          (current.root.sender_id !== corpus.viewerId &&
            thread.root.sender_id === corpus.viewerId)
        ) {
          samples.set(kind, thread);
        }
      }
      const actions: Result["actions"] = {};
      for (const [kind, sample] of samples) {
        const sampleActions = await exercise(
          page,
          sample.root.id,
          messageRequests,
          phone,
          checkout === baseline ? "baseline" : "branch",
        );
        for (const [name, result] of Object.entries(sampleActions)) {
          actions[`${kind}:${name}`] = result;
        }
      }
      await context.close();
      results[phone ? "phone" : "desktop"] = {
        layout: hash(layout),
        cases,
        requests: [...new Set(requests)].sort(),
        errors: [...new Set(errors)].sort(),
        actions,
        controls,
      };
      console.error(
        `${checkout === baseline ? "baseline" : "branch"} ${phone ? "phone" : "desktop"}: done`,
      );
    }
    return results;
  } finally {
    server.kill();
    await server.exited;
    rmSync(link, { recursive: true });
  }
}

if (!existsSync(resolve(baseline, "node_modules"))) {
  throw new Error("Install dependencies in the baseline worktree first");
}
const browser = await chromium.launch({ executablePath: chromiumPath });
browser.on("disconnected", () => console.error("Chromium disconnected"));
try {
  const report: Record<string, unknown> = {
    corpus: {
      threads: corpus.threads.length,
      messages: corpus.threads.reduce(
        (count, thread) => count + 1 + thread.replies.length,
        0,
      ),
      kinds: corpus.threads.reduce<Record<string, number>>((counts, thread) => {
        const kind = corpus.labels?.[thread.root.id] ?? thread.root.parent.type;
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {}),
    },
    cases: 0,
    differences: [],
  };
  const oldResults = await run(baseline, browser);
  const newResults = await run(branch, browser);
  for (const viewport of ["desktop", "phone"]) {
    const oldResult = oldResults[viewport]!;
    const newResult = newResults[viewport]!;
    const differences: string[] = [];
    for (const key of [
      "layout",
      "cases",
      "requests",
      "errors",
      "actions",
      "controls",
    ] as const) {
      if (JSON.stringify(oldResult[key]) !== JSON.stringify(newResult[key]))
        differences.push(key);
    }
    const differingCaseIds = Object.keys(oldResult.cases).filter(
      (id) => oldResult.cases[id] !== newResult.cases[id],
    );
    (report.differences as unknown[]).push({
      viewport,
      fields: differences,
      differingCaseIds,
      old: oldResult,
      current: newResult,
    });
    report.cases =
      Number(report.cases) +
      corpus.threads.length +
      Object.keys(oldResult.actions).length;
  }
  console.log(JSON.stringify(report, null, 2));
  if (
    (report.differences as { fields: string[] }[]).some(
      (item) => item.fields.length,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
