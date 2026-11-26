/**
 * Run by network.test.ts under Node, like the browser host: launches the lab
 * browser with its launch options and no request allowlist, tries the lab
 * and two other addresses, and prints what it reached as one JSON line.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { isolatedBrowser } from '../src/browser-options.ts';
import { LAB_PORT, LAB_URL } from '../src/registry.ts';

const reached = async (
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  url: string
): Promise<string | undefined> => {
  const page = await context.newPage();
  try {
    const response = await page.goto(url);
    return (await response?.text()) ?? undefined;
  } catch {
    return undefined;
  } finally {
    await page.close();
  }
};

const profile = await mkdtemp(join(tmpdir(), 'captcha-vision-lab-test-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: process.env.LAB_CHROMIUM_PATH,
  env: { ...process.env },
  ...isolatedBrowser(),
});
const result = {
  lab: await reached(context, LAB_URL),
  outside: await reached(context, 'http://127.0.0.2:47832/'),
  localhost: await reached(context, `http://localhost:${LAB_PORT}/`),
};
await context.close();
await rm(profile, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(result)}\n`);
