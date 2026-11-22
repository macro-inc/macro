// Drives the flows whose readers moved to the channel directory, as one
// seeded person on the local stack, recording a video and a screenshot per
// step, and the channel list requests the app made.
//
// Run (inside `nix develop`, from the worktree):
//   node ~/.cache/gql-channel-directory/flows.mjs <out-dir> <session.json> <targets.json>
// targets.json: { channel, dmPerson, dmId, newPerson }
import fs from 'node:fs';
import path from 'node:path';

const [outArg, sessionArg, targetsArg] = process.argv.slice(2);
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const BASE = (process.env.BASE ?? 'https://localhost:29509').replace(/\/$/, '');
const session = JSON.parse(fs.readFileSync(sessionArg, 'utf8'));
const targets = JSON.parse(fs.readFileSync(targetsArg, 'utf8'));
const { chromium } = await import(path.resolve('node_modules/playwright/index.mjs'));
const origin = new URL(BASE).origin;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const startedAt = Date.now();
const requests = [];
const steps = [];

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
    '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
  recordVideo: { dir: path.join(outDir, 'video'), size: { width: 1440, height: 900 } },
});
await context.addCookies(session.cookies.split('; ').map((pair) => {
  const at = pair.indexOf('=');
  return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE, httpOnly: true, secure: true };
}));
await context.addInitScript(() => { try { localStorage.setItem('macro:login', 'true'); } catch {} });
await context.route((url) => url.toString().startsWith(`${origin}/`), async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  try {
    const response = await route.fetch({ maxRedirects: 0 });
    const body = request.postData() ?? '';
    const operation = body.match(/"operationName"\s*:\s*"([^"]+)"/)?.[1] ?? null;
    if (url.pathname.startsWith('/dss/comms/channels') || url.pathname.startsWith('/dss/channels/activity') || operation || request.method() !== 'GET')
      requests.push({ atMs: Date.now() - startedAt, method: request.method(), path: url.pathname, operation, status: response.status(), variables: operation === 'DirectMessageChannelId' ? JSON.parse(body).variables : undefined });
    await route.fulfill({ response });
  } catch {
    await route.abort().catch(() => {});
  }
});
await context.route((url) => url.toString().startsWith(`${origin}/i/otlp/`), (route) => route.fulfill({ status: 200, body: '{}' }));

const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

const ONLY = process.env.STEPS?.split(",");
async function step(name, run) {
  if (ONLY && !ONLY.includes(name)) return;
  const from = Date.now() - startedAt;
  let outcome = 'ok';
  let detail;
  try {
    detail = await run();
  } catch (error) {
    outcome = 'failed';
    detail = String(error).slice(0, 500);
  }
  await page.screenshot({ path: path.join(outDir, `${String(steps.length + 1).padStart(2, '0')}-${name}.png`) });
  steps.push({ name, outcome, detail, fromMs: from, toMs: Date.now() - startedAt, url: page.url().replace(origin, '') });
  console.log(JSON.stringify(steps.at(-1)));
}

const CHANNEL_URL = /\/app\/channels\/[0-9a-f-]{36}/;
const SECTION = process.env.SECTION_NAME ?? `Proof ${Date.now().toString(36)}`;

async function quickAccess(text, want) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox').or(page.getByRole('textbox', { name: /search/i })).first();
  await input.waitFor({ timeout: 10_000 });
  await input.fill(text);
  const option = page.getByRole('option').filter({ hasText: want }).first();
  await option.waitFor({ timeout: 20_000 });
  await sleep(800);
  const options = await page.getByRole('option').allTextContents();
  const target = options.findIndex((t) => t.trim().startsWith(want));
  const selected = await page.getByRole('option').evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
  for (let i = selected; i < target; i += 1) await page.keyboard.press('ArrowDown');
  for (let i = selected; i > target; i -= 1) await page.keyboard.press('ArrowUp');
  await sleep(300);
  await page.keyboard.press('Enter');
  return { options: options.map((t) => t.trim()).slice(0, 6) };
}

async function participantsMessage(person) {
  await page.goto(`${BASE}/app/channels/${targets.groupId}`, { waitUntil: 'load', timeout: 60_000 });
  const tabs = page.getByRole('radiogroup', { name: 'Channel sections' });
  await tabs.waitFor({ timeout: 60_000 });
  await tabs.getByText('Participants', { exact: true }).click();
  const link = page.getByRole('main').getByRole('link', { name: new RegExp(`^Message ${person}`) }).first();
  await link.waitFor({ timeout: 30_000 });
  await sleep(800);
  await link.click();
}

async function sectionMenu(item, section = SECTION) {
  await page.getByRole('button', { name: `Options for ${section}` }).first().click();
  const entry = page.getByRole('menuitem', { name: item, exact: typeof item === 'string' }).first();
  try {
    await entry.waitFor({ timeout: 5_000 });
  } catch (error) {
    throw new Error(`${item} not in menu: ${JSON.stringify(await page.getByRole('menuitem').allTextContents())}`);
  }
  await entry.click();
}

await step('open-channels', async () => {
  await page.goto(`${BASE}/app/channels`, { waitUntil: 'load', timeout: 120_000 });
  await page.locator('[data-key^="channel:"]').first().waitFor({ timeout: 120_000 });
  await sleep(3_000);
});

await step('quick-access-channel', async () => {
  const shown = await quickAccess(targets.channel, targets.channel);
  await page.waitForURL(CHANNEL_URL, { timeout: 15_000 });
  await page.getByRole('main').getByText(targets.channel).first().waitFor({ timeout: 15_000 });
  await sleep(1_500);
  return { ...shown, opened: page.url().split('/channels/')[1] };
});

await step('quick-access-dm', async () => {
  const shown = await quickAccess(targets.dmPerson, targets.dmPerson);
  await page.waitForURL(new RegExp(targets.dmId), { timeout: 15_000 });
  await sleep(1_500);
  return { ...shown, opened: page.url().split('/channels/')[1], expected: targets.dmId };
});

await step('participant-existing-dm', async () => {
  await participantsMessage(targets.existingPerson);
  await page.waitForURL(new RegExp(targets.existingDmId), { timeout: 15_000 });
  await sleep(1_500);
  return { opened: page.url().split('/channels/')[1], expected: targets.existingDmId };
});

await step('participant-new-dm', async () => {
  await participantsMessage(targets.newPerson);
  await sleep(3_000);
  const hello = await page.getByText(/say hello/i).count();
  const composer = await page.getByRole('textbox', { name: new RegExp(`share with ${targets.newPerson}`) }).count();
  return { url: page.url().replace(origin, ''), sayHello: hello, composer };
});

await step('back-to-channels', async () => {
  await page.goto(`${BASE}/app/channels`, { waitUntil: 'load', timeout: 60_000 });
  await page.locator('[data-key^="channel:"]').first().waitFor({ timeout: 60_000 });
  await sleep(1_500);
});

await step('new-section', async () => {
  await page.getByRole('button', { name: 'Create channel or direct message' }).first().click();
  await page.getByRole('menuitem', { name: 'New section' }).click();
  await page.getByRole('textbox', { name: 'Section name' }).fill(SECTION);
  await page.getByRole('button', { name: 'Create section' }).click();
  await page.getByRole('button', { name: `Options for ${SECTION}` }).first().waitFor({ timeout: 15_000 });
  await sleep(1_000);
});

await step('add-channels-dialog', async () => {
  await page.getByRole('button', { name: `Add channels to “${SECTION}”` }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10_000 });
  await sleep(500);
  const atOpen = {
    busy: await dialog.locator('[aria-busy="true"]').count(),
    loadingRow: await dialog.getByText('Loading channels…').count(),
    options: await dialog.getByRole('checkbox').count(),
  };
  await page.screenshot({ path: path.join(outDir, `${String(steps.length + 1).padStart(2, '0')}-add-channels-at-open.png`) });
  const openedAt = Date.now();
  await dialog.getByText('Loading channels…').waitFor({ state: 'detached', timeout: 240_000 });
  await sleep(1_000);
  return { atOpen, loadingGoneAfterMs: Date.now() - openedAt, optionsWhenComplete: await dialog.getByRole('checkbox').count() };
});

await step('add-one-channel', async () => {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Search channels' }).fill(targets.channel);
  await sleep(800);
  await dialog.getByText(targets.channel, { exact: true }).first().click();
  await dialog.getByRole('button', { name: /^Add 1 channel/ }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  await sleep(1_500);
});

async function muteUntilOff() {
  const until = page.getByRole('menuitem', { name: 'Until I turn it off' }).first();
  await until.waitFor({ timeout: 5_000 });
  await until.click();
}

await step('mute-section', async () => {
  await sectionMenu('Mute');
  await muteUntilOff();
  await sleep(2_500);
});

await step('unmute-section', async () => {
  await sectionMenu(/^Unmute/);
  await sleep(2_500);
});

await step('mark-section-read', async () => {
  await sectionMenu('Mark all as read');
  await sleep(2_000);
});

await step('mute-direct-messages', async () => {
  await sectionMenu('Mute', 'Direct messages');
  await muteUntilOff();
  await sleep(2_500);
});

await step('unmute-direct-messages', async () => {
  await sectionMenu(/^Unmute/, 'Direct messages');
  await sleep(2_500);
});

await step('delete-section', async () => {
  await sectionMenu('Delete section');
  await sleep(500);
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /^Delete/ });
  if (await confirm.count()) await confirm.last().click();
  await page.getByRole('button', { name: `Options for ${SECTION}` }).first().waitFor({ state: 'detached', timeout: 15_000 });
  await sleep(1_500);
});
await context.close();
await browser.close();
const rest = requests.filter((r) => r.path.startsWith('/dss/comms/channels'));
const activity = requests.filter((r) => r.path.startsWith('/dss/channels/activity'));
const ops = {};
for (const r of requests) if (r.operation) ops[r.operation] = (ops[r.operation] ?? 0) + 1;
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify({ base: BASE, steps, restRequests: rest.length, activityRequests: activity.map((r) => r.method), operations: ops, writes: requests.filter((r) => !r.operation && r.method !== 'GET').map((r) => ({ atMs: r.atMs, method: r.method, path: r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'), status: r.status })), dmLookups: requests.filter((r) => r.operation === 'DirectMessageChannelId').map((r) => ({ atMs: r.atMs, status: r.status })), consoleErrors: consoleErrors.slice(0, 40) }, null, 2));
console.log(JSON.stringify({ restRequests: rest.length, activity: activity.map((r) => r.method), operations: ops }));
