import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
} from '@playwright/test';
import { z } from 'zod';
import { commonBlocksClipboard } from './common-blocks';
import { assertReopened, documentFacts, installSteps } from './contract';
import { committedStorage, waitForDurability } from './persistence';
import { DocumentReceipts } from './protocol';
import { nativeSnapshot } from './snapshot';

const configSchema = z
  .object({
    origin: z.string().url(),
    existingDocumentURL: z.string().url(),
    storageState: z.string(),
    chromium: z.string(),
    output: z.string(),
    expectedWasmSHA256: z.string().regex(/^[a-f0-9]{64}$/),
    candidateArtifacts: z.string().optional(),
    nativeViewModuleURL: z.string().url().optional(),
  })
  .strict();
const input = process.argv[2];
if (!input)
  throw new Error(
    'Usage: bun scripts/editor-live-check/run.ts PRIVATE_CONFIG.json'
  );
const config = configSchema.parse(JSON.parse(await readFile(input, 'utf8')));
const origin = new URL(config.origin);
if (new URL(config.existingDocumentURL).origin !== origin.origin)
  throw new Error('Existing document must use the tested origin');
if (
  config.nativeViewModuleURL &&
  new URL(config.nativeViewModuleURL).origin !== origin.origin
)
  throw new Error('Public view module must use the tested origin');
const output = resolve(config.output);
await mkdir(output, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({
  headless: true,
  executablePath: config.chromium,
});
const errors: string[] = [];
const assets: string[] = [];
const assetReads: Promise<void>[] = [];
const overlays = { glue: 0, wasm: 0 };
const steps: { name: string; status: 'pass' | 'fail'; error?: string }[] = [];
const modules = new WeakMap<Page, string>();

async function context(
  storageState?: string | Awaited<ReturnType<BrowserContext['storageState']>>
) {
  const result = await browser.newContext({
    storageState,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write', 'local-network-access'],
  });
  if (config.candidateArtifacts) {
    const artifacts = resolve(config.candidateArtifacts);
    const wasm = await readFile(
      resolve(artifacts, 'document_session_wasm_bg.wasm')
    );
    if (
      createHash('sha256').update(wasm).digest('hex') !==
      config.expectedWasmSHA256
    )
      throw new Error('Candidate artifact hash mismatch');
    await result.route(
      (url) =>
        /\/document-session\/wasm\/document_session_wasm(?:_bg\.wasm|\.js)$/.test(
          url.pathname
        ),
      async (route) => {
        const file = new URL(route.request().url()).pathname.endsWith('.wasm')
          ? 'document_session_wasm_bg.wasm'
          : 'document_session_wasm.js';
        overlays[file.endsWith('.wasm') ? 'wasm' : 'glue']++;
        await route.fulfill({
          path: resolve(artifacts, file),
          contentType: file.endsWith('.wasm')
            ? 'application/wasm'
            : 'text/javascript',
        });
      }
    );
  }
  result.on('page', (page) => {
    if (config.nativeViewModuleURL)
      modules.set(page, config.nativeViewModuleURL);
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(90_000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        /lexical-wasm-view\/src\/(?:index|view\/editor-view)\.ts(?:\?|$)/.test(
          request.url()
        )
      )
        modules.set(page, request.url());
    });
    page.on('response', (response) => {
      if (
        /\/document_session_wasm_bg(?:-[A-Za-z0-9_-]+)?\.wasm$/.test(
          new URL(response.url()).pathname
        )
      ) {
        const read = async () => {
          const bytes = await response.body();
          assets.push(createHash('sha256').update(bytes).digest('hex'));
        };
        assetReads.push(read());
      }
    });
  });
  return result;
}
function body(page: Page) {
  return page.getByRole('textbox', { name: 'Document content', exact: true });
}
async function ready(page: Page) {
  await expect(body(page)).toBeVisible({ timeout: 90_000 });
  await expect(
    page.locator('[data-block-content] .skeleton-shimmer')
  ).toHaveCount(0, { timeout: 30_000 });
}
async function snapshot(page: Page, requireCommon = false) {
  const module = modules.get(page);
  if (!module)
    throw new Error('Actual served EditorView source module was not observed');
  return nativeSnapshot(page, module, requireCommon);
}
async function step(
  name: (typeof installSteps)[number],
  action: () => Promise<void>
) {
  try {
    await action();
    steps.push({ name, status: 'pass' });
  } catch (error) {
    steps.push({ name, status: 'fail', error: String(error) });
    const failed = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => modules.has(page) && !page.isClosed());
    if (failed) {
      await failed
        .screenshot({
          path: resolve(output, `${name}-failed.png`),
          fullPage: true,
        })
        .catch(() => undefined);
      const model = await snapshot(failed).catch((error) => ({
        error: String(error),
      }));
      const text = await failed
        .locator('body')
        .innerText()
        .catch(() => '');
      await writeFile(
        resolve(output, `${name}-failed.json`),
        JSON.stringify({ model, text }, null, 2),
        { mode: 0o600 }
      );
    }
    throw error;
  }
}
let current: BrowserContext | undefined;
try {
  current = await context(config.storageState);
  const page = await current.newPage();
  const receipts = new DocumentReceipts(page);
  await step('existing-document', async () => {
    await page.goto(config.existingDocumentURL);
    await ready(page);
    await snapshot(page);
  });
  await step('new-document', async () => {
    const before = page.url();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page
      .getByRole('button', { name: 'Create Document', exact: true })
      .click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith('/app/drive/md/') && url.toString() !== before
    );
    await page.reload();
    await ready(page);
    await expect(body(page)).toHaveText('');
    await expect(body(page).locator('p').first()).toBeVisible();
  });
  let typed: Awaited<ReturnType<typeof snapshot>> | undefined;
  await step('type', async () => {
    await body(page).click();
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const installCheck = "durable";');
    await expect(body(page).locator('code')).toHaveText(
      'const installCheck = "durable";'
    );
    typed = await snapshot(page);
  });
  await step('undo-redo', async () => {
    if (!typed) throw new Error('Typing prerequisite failed');
    for (const redo of ['Control+Shift+z', 'Control+y']) {
      await page.keyboard.press('Control+z');
      await expect(body(page).locator('code')).toHaveCount(0);
      await page.keyboard.press(redo);
      await expect(body(page).locator('code')).toHaveText(
        'const installCheck = "durable";'
      );
      const redone = await snapshot(page);
      expect({
        json: redone.json,
        selection: redone.selection,
        domSelection: redone.domSelection,
      }).toEqual({
        json: typed.json,
        selection: typed.selection,
        domSelection: typed.domSelection,
      });
    }
  });
  await step('sign-in', async () => {
    const saved = z
      .object({ cookies: z.array(z.object({ value: z.string() })) })
      .parse(JSON.parse(await readFile(config.storageState, 'utf8')));
    let email: string | undefined;
    for (const cookie of saved.cookies) {
      try {
        const payload = z
          .object({ email: z.string() })
          .parse(
            JSON.parse(
              Buffer.from(
                cookie.value.split('.')[1] ?? '',
                'base64url'
              ).toString()
            )
          );
        if (payload.email.endsWith('@seed.macro.local')) email = payload.email;
      } catch {
        /* Other cookies are not identity tokens. */
      }
    }
    if (!email) throw new Error('Owned synthetic login identity unavailable');
    const fresh = await context();
    try {
      const login = await fresh.newPage();
      await login.goto(`${origin.origin}/app/login`);
      await login
        .getByRole('button', { name: 'Continue with email', exact: true })
        .click();
      await login.locator('input[type=email]').fill(email);
      const identity = login.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            '/auth/user/legacy_user_permissions' && response.status() === 200
      );
      await login
        .getByRole('button', { name: 'Continue', exact: true })
        .click();
      await identity;
      await expect(
        login.getByRole('button', { name: 'Create', exact: true })
      ).toBeVisible({ timeout: 60_000 });
      await login.goto(config.existingDocumentURL);
      await ready(login);
    } finally {
      await fresh.close();
    }
  });
  await step('all-common-blocks-persist-reopen', async () => {
    const doc = new URL(page.url()).pathname.split('/').at(-1);
    if (!doc) throw new Error('Missing document ID');
    const baseline = await committedStorage(page, doc);
    const sentBefore = receipts.sent.length;
    await body(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    const instanceNamespace = (await snapshot(page)).namespace;
    // The real paste handler receives source-authored rich clipboard data. No live state setter is used.
    await body(page).evaluate((root, clipboard) => {
      const data = new DataTransfer();
      data.setData('application/x-lexical-editor', clipboard);
      root.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    }, commonBlocksClipboard(instanceNamespace));
    await expect(body(page)).toContainText('Install end');
    documentFacts((await snapshot(page)).json);
    const durability = await waitForDurability(
      page,
      doc,
      baseline,
      receipts,
      sentBefore
    );
    await page.locator('[contenteditable].text-2xl').click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
    const before = await snapshot(page, true);
    const url = page.url();
    await page.reload();
    await ready(page);
    assertReopened(before, await snapshot(page, true));
    const auth = await current?.storageState();
    if (!auth) throw new Error('Writer context lost');
    await current?.close();
    current = undefined;
    const fresh = await context(auth);
    try {
      const reopened = await fresh.newPage();
      await reopened.goto(url);
      await ready(reopened);
      const after = await snapshot(reopened, true);
      assertReopened(before, after);
      await writeFile(
        resolve(output, 'persistence.json'),
        JSON.stringify({ durability, before, after }, null, 2)
      );
    } finally {
      await fresh.close();
    }
  });
} finally {
  await current?.close();
  await browser.close();
  const reads = await Promise.allSettled(assetReads);
  for (const read of reads)
    if (read.status === 'rejected')
      errors.push(`Unreadable WASM response: ${String(read.reason)}`);
  if (config.candidateArtifacts && (!overlays.glue || !overlays.wasm))
    errors.push(
      'Configured artifact overlay did not serve both matching files'
    );
  const passed =
    steps.length === installSteps.length &&
    steps.every(
      (step, index) =>
        step.name === installSteps[index] && step.status === 'pass'
    ) &&
    !errors.length &&
    assets.length > 0 &&
    assets.every((sha) => sha === config.expectedWasmSHA256);
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        mode: config.candidateArtifacts
          ? 'candidate-browser-artifact-overlay'
          : 'installed',
        passed,
        steps,
        errors,
        assets,
        overlays,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  await chmod(resolve(output, 'result.json'), 0o600);
  if (!passed) process.exitCode = 1;
}
