// Drives the real web app on a local stack: makes a routine with a webhook
// trigger, mints its URL in the editor, POSTs JSON to it from a terminal, and
// checks refused deliveries. Secrets are blurred on screen and redacted here.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const [out, APP, EMAIL] = process.argv.slice(2);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
process.on('unhandledRejection', () => {});
const evidence = { steps: [], posts: [] };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 860 },
  recordVideo: { dir: out, size: { width: 1280, height: 860 } },
});
const page = await ctx.newPage();
const settle = (ms) => page.waitForTimeout(ms);
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV', f.url()); });
const step = async (id, title) => {
  await settle(800);
  await page.screenshot({ path: `${out}/${id}.png` });
  evidence.steps.push({ id, title, at: new URL(page.url()).pathname });
  console.log(id, title);
};
const redact = (s) => s.replace(/mrw_[A-Za-z0-9_-]+/g, 'mrw_<secret>');
const curl = (label, args) => {
  let raw;
  try {
    raw = execFileSync('curl', ['-sSk', '-w', '\n%{http_code}', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    console.log('curl failed', label, e.status, redact(String(e.stderr)), 'host', new URL(args.find((a) => a.startsWith('http'))).host);
    throw new Error('curl failed');
  }
  const lines = raw.trimEnd().split('\n');
  const status = Number(lines.pop());
  const post = { label, command: redact(`curl ${args.map((a) => (/\s|[{}"]/.test(a) ? `'${a}'` : a)).join(' ')}`), status, body: redact(lines.join('\n')) };
  evidence.posts.push(post);
  console.log(label, status, post.body);
  return post;
};
// Blur everything that can show a secret, so neither screenshots nor the video carry one.
await page.addInitScript(() => {
  const css = '[role=dialog] input, [role=dialog] pre, [role=dialog] code, [role=dialog] textarea { filter: blur(7px) !important; }';
  const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
});

await page.goto(`${APP}/app`, { waitUntil: 'domcontentloaded' });
const email = page.getByRole('button', { name: 'Continue with email' });
for (let i = 0; i < 3 && !(await email.waitFor({ timeout: 60000 }).then(() => true, () => false)); i++) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}
await email.waitFor({ timeout: 30000 }).catch(async (e) => { await page.screenshot({ path: `${out}/00-fail.png` }); console.log('URL', page.url()); throw e; });
await settle(5000);
await page.screenshot({ path: `${out}/00-welcome.png` });
const field = page.getByRole('textbox', { name: /^you.company\.com$/ });
for (let i = 0; i < 20 && !(await field.isVisible().catch(() => false)); i++) {
  await email.click({ force: true, timeout: 3000 }).catch(() => {});
  await settle(1500);
}
await field.fill(EMAIL);
await page.getByRole('button', { name: 'Continue', exact: true }).click();
const bypass = page.getByText('Bypass', { exact: true });
await Promise.race([
  bypass.waitFor({ timeout: 60000 }),
  page.waitForURL(/\/app\/home/, { timeout: 60000 }),
]).catch(() => {});
if (await bypass.isVisible().catch(() => false)) await bypass.click();
await page.waitForURL(/\/app\/(home|agents|routines)/, { timeout: 60000 }).catch(async (e) => {
  await page.screenshot({ path: `${out}/00-after-login.png` });
  console.log('URL', page.url());
  throw e;
});
await settle(3000);

// The local stack has no AI to write a step, so the routine (one Ask AI step,
// a weekly schedule) is made through the API; the webhook is added in the editor.
const made = await page.evaluate(async (app) => {
  const res = await fetch(`${app}/scheduled-action/scheduled-actions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ingest build results',
      description: 'Summarize each build result CI posts.',
      enabled: true,
      kind: 'Agent',
      run_visibility: 'unlisted',
      task: { model: 'google/gemini-3.8-flash', prompt: 'Summarize the build result in the webhook body.', user_prompt: 'Summarize the build result in the webhook body.' },
      trigger: { type: 'cron', schedule: '0 0 9 * * 1', timezone: 'UTC' },
    }),
  });
  return { status: res.status, body: await res.text() };
}, APP);
console.log('create', made.status, made.body.slice(0, 300));
const routineId = JSON.parse(made.body).id;
for (let i = 0; i < 4; i++) { if (await page.goto(`${APP}/app/routines/${routineId}`, { waitUntil: "domcontentloaded" }).then(() => true, (e) => { console.log("goto retry", String(e).split("\n")[0]); return false; })) break; await settle(3000); }
const addTrigger = page.getByRole('button', { name: 'Add trigger' }).first();
for (let i = 0; i < 3 && !(await addTrigger.waitFor({ timeout: 45000 }).then(() => true, () => false)); i++) {
  await page.screenshot({ path: `${out}/00-routine-wait-${i}.png` });
  await page.reload({ waitUntil: 'domcontentloaded' });
}
await addTrigger.waitFor({ timeout: 30000 });
await step('01-routine', 'A routine with one Ask AI step and a schedule');

await addTrigger.click();
await page.getByRole('menuitem', { name: 'Webhooks' }).click();
await step('02-menu', 'Add trigger → Webhooks');
await page.getByRole('menuitem', { name: /Webhook received/ }).click();
const panel = page.getByRole('dialog', { name: 'Add trigger' });
await panel.getByText('Webhook URL', { exact: true }).waitFor();
await step('03-webhook-panel', 'The Webhook received panel');
await panel.getByRole('button', { name: 'Add trigger' }).click();
await page.getByText('Saved', { exact: true }).waitFor({ timeout: 30000 }).catch(() => {});
await settle(2000);
await step('04-saved', 'Saved beside the schedule: "Webhook received at its URL"');

const openPanel = async () => {
  const trig = page.getByRole('button', { name: 'URL for Webhook received' });
  for (let i = 0; i < 3 && !(await (async () => { for (let t = 0; t < 40; t++) { if (await trig.isEnabled().catch(() => false)) return true; await settle(500); } return false; })()); i++) { await page.screenshot({ path: `${out}/dbg-disabled-${i}.png` }); await page.reload({ waitUntil: 'domcontentloaded' }); await settle(4000); }
  await trig.click();
  const dialog = page.getByRole('dialog', { name: 'Edit trigger' });
  await dialog.getByText('Webhook URL', { exact: true }).waitFor();
  return dialog;
};
const closePanel = async () => {
  await page.getByRole('dialog', { name: 'Edit trigger' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('dialog', { name: 'Edit trigger' }).waitFor({ state: 'hidden' });
  await settle(1500);
};
let dialog = await openPanel();
await step('05-panel', 'Its panel, before a URL exists');
await dialog.getByRole('button', { name: 'Create URL' }).click();
const urlBox = dialog.getByRole('textbox', { name: 'Webhook URL' });
await urlBox.waitFor();
const first = await urlBox.inputValue();
await step('06-url-made', 'Create URL: the URL, a JSON curl example and the bearer form, shown once (blurred here)');
await closePanel();
await settle(1000);
dialog = await openPanel();
await step('07-reopened', 'Reopened: only when it was made; the secret is gone');
await closePanel();

const body = JSON.stringify({ build: 4821, status: 'passed', branch: 'main', tests: { passed: 912, failed: 0 } });
curl('A JSON POST to the URL', ['-X', 'POST', first, '-H', 'Content-Type: application/json', '--data', body]);

await page.getByRole('tab', { name: 'Runs', exact: true }).or(page.getByRole('button', { name: 'Runs', exact: true })).first().click();
await page.getByText('Webhook body').first().waitFor({ timeout: 120000 }).catch(() => {});
await settle(3000);
await step('08-run', 'The run it started, with the body as sent');

const hook = first.match(/hooks\/([^/]+)\//)[1];
const origin = new URL(first).origin;
curl('No secret (bearer form, no Authorization)', ['-X', 'POST', `${origin}/scheduled-action/hooks/${hook}`, '-H', 'Content-Type: application/json', '--data', body]);
curl('A wrong secret', ['-X', 'POST', `${origin}/scheduled-action/hooks/${hook}/mrw_wrongwrongwrongwrongwrongwrongwrongwrong0`, '--data', body]);

await page.getByRole('tab', { name: 'Overview', exact: true }).or(page.getByRole('button', { name: 'Overview', exact: true })).first().click();
dialog = await openPanel();
await dialog.getByRole('button', { name: 'New URL' }).click();

const second = await dialog.getByRole('textbox', { name: 'Webhook URL' }).inputValue({ timeout: 30000 });
await step('09-rotated', 'New URL: the old one stops working at once (blurred here)');
await closePanel();
curl('The old URL, after rotation', ['-X', 'POST', first, '-H', 'Content-Type: application/json', '--data', body]);
curl('The new URL', ['-X', 'POST', second, '-H', 'Content-Type: application/json', '--data', JSON.stringify({ build: 4822, status: 'failed' })]);


// A routine whose one code step reads the posted JSON. Made through the API (the
// local stack has no AI to write code) with only a webhook trigger; its URL is
// made by the owner's own session, the same call the panel's Create URL makes.
const apiOnce = async (method, path, body, headers = {}) =>
  page.evaluate(async ({ app, method, path, body, headers }) => {
    const res = await fetch(`${app}${path}`, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.text() };
  }, { app: APP, method, path, body, headers });
const api = async (...args) => {
  for (let i = 0; ; i++) {
    try { return await apiOnce(...args); } catch (e) { if (i >= 4) throw e; console.log("api retry", args[1], String(e).split("\n")[0]); await settle(3000); }
  }
};
const source = [
  'export async function main({ trigger }: StepContext) {',
  "  if (trigger.kind !== 'event') return null;",
  '  const sent = trigger.item.webhook?.json;',
  "  if (typeof sent?.build !== 'number') return null;",
  '  return { build: sent.build, status: sent.status, failed: sent.tests?.failed ?? null };',
  '}',
].join('\n');
const coded = await api('POST', '/scheduled-action/scheduled-actions', {
  name: 'Read the build from the webhook',
  description: 'A code step reads the posted JSON.',
  enabled: true,
  kind: 'Agent',
  run_visibility: 'unlisted',
  task: { steps: [{ type: 'code', id: 'read_build', title: 'Read the build', source }] },
  trigger: { type: 'events', filters: [{ events: ['webhook'] }] },
});
console.log('create code routine', coded.status, coded.body.slice(0, 1500));
const codeId = JSON.parse(coded.body).id;
const minted = await api('POST', `/scheduled-action/scheduled-actions/${codeId}/webhook`);
console.log('mint', minted.status);
const codeUrl = JSON.parse(minted.body).url;
const codeBody = JSON.stringify({ build: 5107, status: 'failed', branch: 'main', tests: { passed: 905, failed: 7 } });
curl('A JSON POST to the code routine', ['-X', 'POST', codeUrl, '-H', 'Content-Type: application/json', '--data', codeBody]);
await page.goto(`${APP}/app/routines/${codeId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('tab', { name: 'Runs', exact: true }).or(page.getByRole('button', { name: 'Runs', exact: true })).first().click({ timeout: 60000 });
await page.getByText('5107').first().waitFor({ timeout: 180000 }).catch(() => console.log('no 5107 on runs tab'));
await page.getByText('Show output').first().click({ timeout: 60000 });
await page.getByText('"failed": 7').or(page.getByText('"failed":7')).first().waitFor({ timeout: 30000 }).catch(() => console.log('no failed:7 in output'));
await settle(3000);
await step('10-code-run', 'The code routine’s run: its step read build 5107 and 7 failed tests from the posted JSON');
evidence.codeRunText = (await page.locator('main').innerText().catch(() => '')).slice(0, 4000);

// The owner routes refuse an API token, even the owner's own key.
const key = await api('POST', '/dss/user-api-keys', { name: 'webhook proof' });
console.log('api key', key.status);
const apiKey = JSON.parse(key.body).key;
const routeUrl = `${APP}/scheduled-action/scheduled-actions/${codeId}/webhook`;
const keyed = (label, method) => {
  const post = curl(label, ['-X', method, routeUrl, '-H', `x-macro-user-api-key: ${apiKey}`]);
  post.command = post.command.replace(apiKey, '<api key>');
  return post;
};
keyed('Read the URL with an API key', 'GET');
keyed('Make or replace the URL with an API key', 'POST');
keyed('Delete the URL with an API key', 'DELETE');
curl('The code routine’s URL still works after those refusals', ['-X', 'POST', codeUrl, '-H', 'Content-Type: application/json', '--data', JSON.stringify({ build: 5108, status: 'passed' })]);

evidence.routineId = routineId;
evidence.codeRoutineId = codeId;
evidence.hookChanged = first.split('/hooks/')[1].split('/')[0] !== second.split('/hooks/')[1].split('/')[0];
const secrets = [first, second, codeUrl, apiKey].map((u) => u.split('/').pop());
const text = JSON.stringify(evidence, null, 2);
if (secrets.some((s) => text.includes(s))) throw new Error('a secret reached the evidence');
writeFileSync(`${out}/evidence.json`, text);
await ctx.close();
await browser.close();
