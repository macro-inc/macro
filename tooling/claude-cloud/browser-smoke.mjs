// Local UI smoke only: creates a disposable local Macro identity, never authorizes Claude.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
const require = createRequire(
  new URL('../../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');
const { values } = parseArgs({
  options: { origin: { type: 'string', default: 'http://localhost:25510' } },
});
const origin = new URL(values.origin);
if (origin.hostname !== 'localhost' || origin.protocol !== 'http:')
  throw new Error('Localhost only');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
  });
  await page.goto(`${origin}/app`);
  await page
    .getByRole('button', { name: 'Continue with email' })
    .click({ timeout: 60000 });
  await page
    .getByPlaceholder('you@company.com')
    .fill('claude-ui-demo@example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(/\/app\/(component|settings)/, { timeout: 60000 });
  // Vite-only local smoke: simulate the local env override in this browser.
  // Local dev intentionally does not initialize PostHog. Keep the real flag
  // definition/readers, and never alter the running server's environment.
  let claudeEnabled = false;
  await page.route(
    '**/src/lib/core/constant/featureFlags.ts*',
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const definition = 'export const claudeCloud = defineFlag({';
      if (!body.includes(definition))
        throw new Error('Claude flag definition not found');
      await route.fulfill({
        response,
        body: body.replace(
          definition,
          `import.meta.env.VITE_CLAUDE_CLOUD = '${claudeEnabled}';\n${definition}`
        ),
      });
    }
  );
  const claudeRequests = [];
  page.on('request', (request) => {
    if (!['fetch', 'xhr'].includes(request.resourceType())) return;
    if (
      request.url().includes('/claude-auth/') ||
      (request.url().includes('/models') &&
        request.postData()?.includes('claude-cloud'))
    )
      claudeRequests.push(request.url());
  });
  await page.goto(`${origin}/app/settings/harness`);
  await page.getByRole('heading', { name: 'Cursor', exact: true }).waitFor();
  const card = page.getByRole('region', { name: 'Claude Cloud connection' });
  if (await card.count())
    throw new Error('Claude connection visible with flag off');
  await page.goto(`${origin}/app/settings/agents?createAgent=true`);
  await page.getByRole('dialog').waitFor();
  if (await page.getByRole('option', { name: 'Claude Cloud (demo)' }).count())
    throw new Error('Claude harness visible with flag off');
  if (claudeRequests.length)
    throw new Error('Claude data fetched with flag off');
  console.log(
    'PASS: flag off hides onboarding and harness selection without Claude requests.'
  );
  await page.goto(`${origin}/app/settings/harness`);
  await page.getByRole('heading', { name: 'Cursor', exact: true }).waitFor();
  claudeEnabled = true;
  await page.reload();
  await card.waitFor({ timeout: 60000 });
  console.log('PASS: Claude connection card is visible before authorization.');
  await card.getByLabel('Anthropic').waitFor();
  const order = await page.getByRole('heading', { level: 2 }).allTextContents();
  if (order.indexOf('Claude Cloud (demo)') >= order.indexOf('Cursor'))
    throw new Error('Claude must appear above Cursor');
  // Reloading after the backend build is a manual step; this script fails visibly if stale.
  await page
    .context()
    .route('https://claude.com/**', (route) =>
      route.fulfill({ body: 'Claude sign-in intercepted by local smoke test' })
    );
  const signInOpening = page.waitForEvent('popup');
  const starting = page.waitForResponse(
    (response) =>
      response.url().endsWith('/claude-auth/start') &&
      response.request().method() === 'POST'
  );
  await card
    .getByRole('button', { name: 'Connect Claude', exact: true })
    .click({ timeout: 30000 });
  const start = await starting;
  if (start.status() !== 200 || start.headers()['cache-control'] !== 'no-store')
    throw new Error('Start response must be successful and non-cacheable');
  const attempt = await start.json();
  const consent = card.getByRole('link', { name: /Open Claude sign-in/ });
  await consent.waitFor({ timeout: 15000 });
  const url = new URL(await consent.getAttribute('href'));
  const signIn = await signInOpening;
  await signIn.waitForURL(url.href);
  if (!(await signIn.evaluate(() => window.opener === null)))
    throw new Error('Claude sign-in tab must not retain an opener');
  await signIn.close();
  console.log(
    'PASS: the first Connect Claude click opens sign-in with no opener (provider intercepted).'
  );
  if (
    url.origin !== 'https://claude.com' ||
    url.pathname !== '/cai/oauth/authorize' ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    url.searchParams.get('redirect_uri') !==
      'https://platform.claude.com/oauth/code/callback'
  )
    throw new Error('Incorrect consent URL');
  if (
    (await card.getByLabel(/Paste the complete/).getAttribute('type')) !==
    'password'
  )
    throw new Error('Code input is not masked');
  await page.screenshot({
    path: '/tmp/claude-auth-settings.png',
    fullPage: true,
  });
  console.log(
    'PASS: authenticated start returned the registered Claude PKCE consent URL and masked code entry.'
  );
  const completeUrl = start.url().replace(/\/start$/, '/complete');
  const wrongState = await page.request.post(completeUrl, {
    data: { attemptId: attempt.attemptId, code: 'dummy-code#wrong-state' },
  });
  if (wrongState.status() !== 400)
    throw new Error('Mismatched OAuth state was not rejected');
  const ownerInjection = await page.request.post(completeUrl, {
    data: {
      attemptId: attempt.attemptId,
      code: 'dummy-code#wrong-state',
      owner: 'macro|someone-else@example.com',
    },
  });
  if (ownerInjection.status() !== 422)
    throw new Error('Caller-selected owner was not rejected');
  console.log(
    'PASS: wrong state and caller-supplied ownership are rejected before provider exchange.'
  );
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card
    .getByRole('button', { name: 'Connect Claude', exact: true })
    .waitFor();
  console.log(
    'PASS: cancel forgets the pending connection. No Claude grant or subscription turn was used.'
  );
  const replay = await page.request.post(completeUrl, {
    data: {
      attemptId: attempt.attemptId,
      code: `dummy-code#${url.searchParams.get('state')}`,
    },
  });
  if (replay.status() !== 409)
    throw new Error('Canceled attempt was not rejected');
  console.log('PASS: a canceled attempt cannot be exchanged.');
  await page.evaluate(() => {
    const original = window.open;
    window.open = () => {
      window.open = original;
      return null;
    };
  });
  await card
    .getByRole('button', { name: 'Connect Claude', exact: true })
    .click();
  await card
    .getByRole('link', { name: /Didn't open\? Open Claude sign-in/ })
    .waitFor();
  await card.getByLabel(/Paste the complete/).waitFor();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log(
    'PASS: a blocked popup retains the fallback sign-in link and code entry.'
  );
  await page.goto(`${origin}/app/settings/agents`);
  await page
    .getByRole('heading', { name: 'Agents', exact: true })
    .waitFor({ timeout: 30000 });
  if (
    await page.getByRole('region', { name: 'Claude Cloud connection' }).count()
  )
    throw new Error('Connection belongs in Harness, not Agents');
  console.log(
    'PASS: Claude connection appears only in Harness settings, above Cursor, with the Anthropic logo.'
  );
  // Controlled read-only session fixture: exercise the real toolbar without
  // creating a cloud session or touching another user's conversation.
  const fixtureId = '00000000-0000-7000-8000-000000000123';
  const cloudUrl = 'https://claude.ai/code/cse_browser_fixture';
  await page.route(`**/agent-sessions/${fixtureId}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const bot = {
      id: '00000000-0000-7000-8000-000000000124',
      name: 'Claude demo',
      handle: 'claude-demo',
    };
    const body = path.endsWith('/log')
      ? { bot, entries: [] }
      : path.endsWith('/queue')
        ? []
        : {
            id: fixtureId,
            botId: bot.id,
            ownerId: 'macro|claude-ui-demo@example.com',
            canEdit: false,
            name: 'Claude cloud link check',
            harness: 'claude-cloud',
            model: 'claude-default',
            workspace: '/',
            sandboxSize: 'small',
            status: { kind: 'disconnected' },
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            external: { provider: 'claude-cloud', url: cloudUrl },
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  await page.context().route('https://claude.ai/**', (route) =>
    route.fulfill({
      body: 'Claude link target intercepted by local smoke test',
    })
  );
  await page.goto(`${origin}/app/agent/${fixtureId}`);
  const openClaude = page.getByRole('button', {
    name: 'Open in Claude',
    exact: true,
  });
  await openClaude.waitFor({ timeout: 60000 });
  const opened = page.waitForEvent('popup');
  await openClaude.click();
  const popup = await opened;
  await popup.waitForURL(cloudUrl);
  await popup.close();
  await page.screenshot({
    path: '/tmp/claude-session-link.png',
    fullPage: true,
  });
  console.log(
    'PASS: the real session toolbar opens the Claude URL in a new tab (controlled session fixture).'
  );
} finally {
  await browser.close();
}
