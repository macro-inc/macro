import { expect, type Page, type Route, test } from '@playwright/test';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import type { Harness as RegisteredHarness } from '@service-storage/client';

/** Where to also copy every screenshot, for a PR; unset keeps them in test-results. */
const screenshotDirectory = process.env.COMPUTERS_SCREENSHOT_DIR;

const offers: SizeOffer[] = [
  {
    size: 'standard',
    vcpus: 2,
    memoryGb: 8,
    diskGb: 64,
    quote: {
      size: 'standard',
      priceId: 'price_standard',
      amount: 4000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: false,
  },
];

const computer: ComputerStatus = {
  id: 'computer-1',
  name: "Maya's Agent Box",
  size: 'standard',
  vcpus: 2,
  memoryGib: 8,
  diskGib: 64,
  catalogEntry: 'standard@2026-11',
  status: 'setting_up',
  billing: 'active',
  setup: { step: 'creating', position: 1, total: 4 },
  poweredOn: false,
  agentCount: 0,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'maya@example.com',
  createdAt: new Date().toISOString(),
  harnessId: null,
  defaultAgentId: null,
  setupCompletedAt: null,
};

const harness: RegisteredHarness = {
  id: 'harness-1',
  name: "Maya's Agent Box",
  kind: 'macrod',
  owner: { type: 'user', user_id: 'maya@example.com' },
  access: 'owner',
  shared_team_ids: [],
  created_by: 'maya@example.com',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  connected: true,
  last_connected_at: null,
  allow_permission_bypass: true,
  computer_id: 'computer-1',
  claude_mode: 'macro_credits',
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

async function shoot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  if (screenshotDirectory) {
    const file = `${screenshotDirectory}/${name}-${test.info().project.name}.png`;
    await page.screenshot({ path: file, fullPage: false });
  }
  await pace(page, 2_000);
}

/** A recording holds each beat long enough to read; a plain run does not wait. */
const pace = (page: Page, ms = 1_200) =>
  screenshotDirectory ? page.waitForTimeout(ms) : Promise.resolve();

const dialog = (page: Page) => page.getByRole('dialog');
const row = (page: Page) =>
  page.locator('[data-runtime-row="Maya\'s Agent Box"]');

// The fixture's service clients point at the hosted dev gateway; anything a
// test does not answer itself is refused, so nothing reaches a real backend.
test.beforeEach(async ({ page }) => {
  await page.route(/\.macro\.com\//, (route) => route.abort());
  page.on('pageerror', (error) => console.log('pageerror', error.stack));
});

// The whole path as a video for the pull request, when screenshots are kept.
test.use({ video: screenshotDirectory ? 'on' : 'off' });

test('closes during setup, is told the computer is ready, and finishes from the notice', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let computers: ComputerStatus[] = [];
  await page.route('**/auth/team/computers', (route) => {
    if (route.request().method() === 'GET') return json(route, 200, computers);
    computers = [computer];
    return json(route, 200, { computerId: 'computer-1', state: 'ready' });
  });
  await page.route('**/auth/team/computers/offers', (route) =>
    json(route, 200, offers)
  );
  await page.route('**/auth/team/computers/*/setup-complete', (route) => {
    computers = computers.map((current) => ({
      ...current,
      setupCompletedAt: '2026-01-02T00:00:00Z',
    }));
    return json(route, 200, computers[0]);
  });

  await page.goto('/');
  // A cold dev server can take a while to serve the first page.
  await expect(
    page.getByRole('button', { name: 'Get a computer' })
  ).toBeVisible({ timeout: 60_000 });
  await pace(page);
  await page.getByRole('button', { name: 'Get a computer' }).click();
  await pace(page);
  await dialog(page)
    .getByRole('button', { name: 'Buy · $40.00/month' })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: "Let's set up an agent on it" })
  ).toBeVisible();
  await pace(page);

  // Closing right after Buy never cancels anything: the row carries the live
  // setup line.
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page)).toContainText(/Setting up/);
  await pace(page, 2_000);

  // The computer connects, and its notification arrives.
  computers = [
    {
      ...computer,
      status: 'ready',
      poweredOn: true,
      setup: undefined,
      harnessId: 'harness-1',
      defaultAgentId: 'bot-1',
    },
  ];
  await page.evaluate(
    async ([registered]) => {
      window.computerFixture.setHarnesses([registered]);
      window.computerFixture.setAgents([
        { bot: { id: 'bot-1', name: "Maya's Agent" }, harness_id: 'harness-1' },
      ]);
      await window.computerFixture.notify({
        computerId: 'computer-1',
        harnessId: 'harness-1',
        computerName: "Maya's Agent Box",
        outcome: { kind: 'ready' },
      });
    },
    [harness] as const
  );
  await expect(
    page.getByText('Your computer is ready: connect your AI and finish setup')
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Maya's Agent Box is up.")).toBeVisible();
  // The notification refreshes the row behind it: no longer setting up.
  await expect(row(page)).not.toContainText('Setting up');
  await shoot(page, 'notice-ready');

  // Its action reopens the same dialog on Bring your AI.
  await page.getByRole('button', { name: 'Finish setup' }).last().click();
  await expect(
    dialog(page).getByRole('link', { name: 'Open claude.ai' })
  ).toBeVisible({ timeout: 10_000 });
  // The notice goes once the dialog it opened takes over.
  await expect(
    page.getByText('Your computer is ready: connect your AI and finish setup')
  ).toHaveCount(0);
  const steps = dialog(page).getByRole('list', { name: 'Setup steps' });
  await expect(steps.getByRole('listitem').nth(2)).toHaveAttribute(
    'aria-current',
    'step'
  );
  await shoot(page, 'notice-reopened');

  // claude.ai opens in a new tab; the test never reaches it.
  await page
    .context()
    .route('https://claude.ai/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    );
  const claudeTab = page.context().waitForEvent('page');
  await dialog(page).getByRole('link', { name: 'Open claude.ai' }).click();
  await (await claudeTab).close();
  await dialog(page)
    .getByRole('button', { name: 'Use Macro credits instead' })
    .click();
  await expect(
    dialog(page).getByRole('heading', { name: "Maya's Agent is ready" })
  ).toBeVisible({ timeout: 10_000 });
  await dialog(page)
    .getByRole('button', { name: 'Create an agent on this computer' })
    .click();
  const form = page.getByRole('region', { name: 'New agent' });
  await expect(form).toBeVisible({ timeout: 60_000 });
  await expect(
    form
      .getByRole('group', { name: 'Where it runs' })
      .getByRole('radio', { name: /On a Macro computer/ })
  ).toBeChecked();
  await form
    .getByText('On a Macro computer')
    .evaluate((label) => label.scrollIntoView({ block: 'center' }));
  // Hold on the result so the recording ends on it.
  await page.waitForTimeout(1_500);
});

test('a failed setup notice says why and reopens setup to Retry', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failed = {
    ...computer,
    status: 'failed' as const,
    failureReason: 'The host ran out of disk.',
  };
  await page.route('**/auth/team/computers', (route) =>
    json(route, 200, [failed])
  );
  await page.route('**/auth/team/computers/offers', (route) =>
    json(route, 200, offers)
  );
  await page.goto('/');
  await expect(row(page)).toContainText('Failed');

  await page.evaluate(() =>
    window.computerFixture.notify({
      computerId: 'computer-1',
      harnessId: null,
      computerName: "Maya's Agent Box",
      outcome: { kind: 'failed', failureReason: 'The host ran out of disk.' },
    })
  );
  await expect(
    page.getByText("Maya's Agent Box could not be set up")
  ).toBeVisible({ timeout: 30_000 });
  await shoot(page, 'notice-failed');

  await page.getByRole('button', { name: 'Retry setup' }).last().click();
  await expect(
    dialog(page)
      .getByRole('list', { name: 'Setup progress' })
      .getByRole('button', { name: 'Retry setup' })
  ).toBeVisible({ timeout: 10_000 });
  // Setup is stopped: the sign-in step waits on Retry, with nothing spinning
  // and no action that cannot work.
  await expect(dialog(page)).toContainText(
    'Setup stopped before the computer came up'
  );
  await expect(dialog(page)).not.toContainText('Preparing sign-in');
  await expect(
    dialog(page).getByRole('button', { name: 'Use Macro credits instead' })
  ).toHaveCount(0);
  await shoot(page, 'notice-failed-reopened');
});
