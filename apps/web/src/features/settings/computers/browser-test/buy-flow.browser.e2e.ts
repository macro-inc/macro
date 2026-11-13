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
  {
    size: 'large',
    vcpus: 4,
    memoryGb: 16,
    diskGb: 128,
    quote: {
      size: 'large',
      priceId: 'price_large',
      amount: 8000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: false,
  },
  {
    size: 'xl',
    vcpus: 8,
    memoryGb: 32,
    diskGb: 256,
    quote: {
      size: 'xl',
      priceId: 'price_xl',
      amount: 16000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: true,
  },
];

const computer: ComputerStatus = {
  id: 'computer-1',
  name: "Maya's Agent Box",
  size: 'large',
  vcpus: 4,
  memoryGib: 16,
  diskGib: 128,
  catalogEntry: 'large@2026-11',
  status: 'setting_up',
  billing: 'active',
  setup: { step: 'creating', position: 1, total: 4 },
  poweredOn: false,
  agentCount: 0,
  canUndoCancel: false,
  canRestore: false,
  purchasedBy: 'maya@example.com',
  // The first setup stage counts from the purchase.
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
}

const dialog = (page: Page) => page.getByRole('dialog');

// The fixture's service clients point at the hosted dev gateway; anything a
// test does not answer itself is refused, so nothing reaches a real backend.
test.beforeEach(async ({ page }) => {
  await page.route(/\.macro\.com\//, (route) => route.abort());
  page.on('pageerror', (error) => console.log('pageerror', error.stack));
});

/**
 * A Machines page whose team has no computers, with Get a computer pressed
 * while the sizes are still loading. Only then does `answer` reply: a refusal
 * that lands first turns the row into its own notice, and there is no dialog
 * to open.
 */
async function openBuyFlow(
  page: Page,
  answer: (route: Route) => Promise<void> | void
) {
  let opened = () => {};
  const dialogOpened = new Promise<void>((resolve) => {
    opened = resolve;
  });
  await page.route('**/auth/team/computers', (route) => {
    if (route.request().method() === 'GET') return json(route, 200, []);
    return route.fallback();
  });
  await page.route('**/auth/team/computers/offers', async (route) => {
    await dialogOpened;
    return answer(route);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get a computer' }).click();
  await expect(dialog(page)).toBeVisible();
  opened();
}

for (const ending of ['Try it', 'Create an agent on this computer'] as const)
  test(`shows a skeleton while sizes load, then the sizes, and buys through to ${ending}`, async ({
    page,
  }) => {
    // The composer and Agents settings are large graphs on a cold server.
    test.setTimeout(120_000);
    let releaseOffers = () => {};
    const offersReady = new Promise<void>((resolve) => {
      releaseOffers = resolve;
    });
    let computers: ComputerStatus[] = [];
    let chargeConfirmedAt = Number.POSITIVE_INFINITY;
    await page.route('**/auth/team/computers', async (route) => {
      if (route.request().method() === 'GET') {
        // The charge is confirmed a few seconds after the purchase.
        if (
          computers[0]?.status === 'purchasing' &&
          Date.now() >= chargeConfirmedAt
        )
          computers = [computer];
        return json(route, 200, computers);
      }
      computers = [
        { ...computer, status: 'purchasing', billing: 'purchasing' },
      ];
      chargeConfirmedAt = Date.now() + 4_000;
      return json(route, 202, {
        computerId: 'computer-1',
        state: 'confirming',
      });
    });
    await page.route('**/auth/team/computers/offers', async (route) => {
      await offersReady;
      return json(route, 200, offers);
    });
    await page.route('**/auth/team/computers/*/setup-complete', (route) => {
      computers = computers.map((current) => ({
        ...current,
        setupCompletedAt: '2026-01-02T00:00:00Z',
      }));
      return json(route, 200, computers[0]);
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Get a computer' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(
      dialog(page).getByRole('status', { name: 'Loading computer sizes' })
    ).toBeVisible();
    await shoot(page, 'buy-loading');

    releaseOffers();
    const steps = dialog(page).getByRole('list', { name: 'Setup steps' });
    const phone = test.info().project.name === 'phone';
    await expect(steps.getByRole('listitem')).toHaveText(
      phone
        ? ['Buy', 'Agent', 'Your AI', 'Create']
        : ['Buy computer', 'Configure agent', 'Bring your AI', 'Create agent']
    );
    // One line on a phone: every step shares the first step's top edge.
    const tops = await steps
      .getByRole('listitem')
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top)
      );
    expect(new Set(tops).size).toBe(1);
    await expect(
      dialog(page).getByRole('radio', { name: 'Large' })
    ).toBeVisible();
    await expect(
      dialog(page).getByRole('radio', { name: 'XL' })
    ).toBeDisabled();
    await shoot(page, 'buy-sizes');

    await dialog(page).getByRole('radio', { name: 'Large' }).check();
    await dialog(page)
      .getByRole('button', { name: 'Buy · $80.00/month' })
      .click();
    await expect(
      dialog(page).getByRole('heading', { name: "Let's set up an agent on it" })
    ).toBeVisible();
    await expect(steps.getByRole('listitem').nth(1)).toHaveAttribute(
      'aria-current',
      'step'
    );
    await shoot(page, 'buy-agent');

    // Billing comes first, then setup carries on behind the step, with the
    // stage and its elapsed time.
    const progress = dialog(page).getByRole('list', { name: 'Setup progress' });
    await expect(progress.getByRole('listitem').first()).toHaveText(
      /Updating billing…\s*\d+:\d\d/
    );
    await expect(
      page.locator('[data-runtime-row="Maya\'s Agent Box"]')
    ).toContainText(/Setting up · Updating billing… · \d+:\d\d/);
    await shoot(page, 'buy-billing');
    await expect(progress.getByRole('listitem')).toHaveText(
      [
        'Billing updated',
        /Creating the computer\s*\d+:\d\d/,
        'Starting up',
        'Connecting to Macro',
        'Sign in to Claude',
      ],
      { timeout: 10_000 }
    );
    // Continue is disabled until a Claude is chosen, and says so.
    await expect(
      dialog(page).getByRole('button', { name: 'Continue' })
    ).toBeDisabled();
    await expect(dialog(page)).toContainText(
      'Choose which Claude it should use to continue.'
    );
    await expect(
      page.locator('[data-runtime-row="Maya\'s Agent Box"]')
    ).toContainText(/Setting up · Creating the computer \(1 of 3\) · \d+:\d\d/);

    await dialog(page)
      .getByRole('radio', { name: 'Your Claude account' })
      .check();
    await dialog(page).getByRole('button', { name: 'Continue' }).click();
    await expect(
      dialog(page).getByRole('heading', { name: 'Sign in to Claude' })
    ).toBeVisible();
    // Nothing greyed out: the step says what it waits for, and the sign-in
    // stage is listed as a later one that unlocks by itself.
    await expect(dialog(page).getByRole('status')).toHaveText(
      /Preparing sign-in… Creating the computer · \d+:\d\d/
    );
    await expect(
      dialog(page).getByRole('button', { disabled: true })
    ).toHaveCount(0);
    await expect(progress.getByRole('listitem').nth(4)).toContainText(
      'Sign in to Claude'
    );
    await shoot(page, 'buy-claude-waiting');

    // The computer connects: the row behind refreshes, and the link is ready.
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
      ([registered]) => {
        window.computerFixture.setHarnesses([registered]);
        window.computerFixture.setAgents([
          {
            bot: { id: 'bot-1', name: "Maya's Agent" },
            harness_id: 'harness-1',
          },
        ]);
      },
      [harness] as const
    );
    await expect(
      dialog(page).getByRole('link', { name: 'Open claude.ai' })
    ).toBeVisible({ timeout: 10_000 });
    await shoot(page, 'buy-claude-ready');

    // The link opens claude.ai in a new tab; the test never reaches it.
    await page
      .context()
      .route('https://claude.ai/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '' })
      );
    const claudeTab = page.context().waitForEvent('page');
    await dialog(page).getByRole('link', { name: 'Open claude.ai' }).click();
    await (await claudeTab).close();
    await expect(
      dialog(page).getByLabel('Paste the code Claude showed you')
    ).toBeVisible();
    await shoot(page, 'buy-claude-code');

    await dialog(page)
      .getByRole('button', { name: 'Use Macro credits instead' })
      .click();
    await expect(
      dialog(page).getByRole('heading', { name: "Maya's Agent is ready" })
    ).toBeVisible({ timeout: 10_000 });
    await expect(progress).toHaveCount(0);
    await expect(steps.getByRole('listitem').last()).toHaveAttribute(
      'aria-current',
      'step'
    );
    await expect(
      dialog(page).getByRole('button', { name: 'Try it' })
    ).toBeEnabled();
    await expect(
      dialog(page).getByRole('button', {
        name: 'Create an agent on this computer',
      })
    ).toBeEnabled();
    await shoot(page, 'buy-ready');

    await dialog(page).getByRole('button', { name: ending }).click();
    await expect(dialog(page)).toHaveCount(0);
    if (ending === 'Try it') {
      // A phone composer shows its agent once it is tapped.
      if (phone)
        await page.locator('[contenteditable="true"]').first().click({
          timeout: 60_000,
        });
      // The composer starts in Code with the agent the flow configured.
      await expect(page.getByRole('button', { name: 'Agent' })).toHaveAttribute(
        'title',
        /Maya's Agent/,
        { timeout: 60_000 }
      );
      await expect(page.getByRole('radio', { name: 'Code' })).toBeChecked();
      // A phone shows the agent as an icon; its sheet names the selection.
      if (phone) {
        await page.getByRole('button', { name: 'Agent' }).click();
        await expect(page.getByText("Maya's Agent").first()).toBeVisible();
      }
      await shoot(page, 'try-it-composer');
      return;
    }
    // The create form, with this computer chosen under Where it runs.
    const form = page.getByRole('region', { name: 'New agent' });
    await expect(form).toBeVisible({ timeout: 60_000 });
    const where = form.getByRole('group', { name: 'Where it runs' });
    await expect(
      where.getByRole('radio', { name: /On a Macro computer/ })
    ).toBeChecked();
    await expect(
      where.getByRole('radio', { name: 'In Macro' })
    ).not.toBeChecked();
    await where.getByText('On a Macro computer').evaluate((label) => {
      label.scrollIntoView({ block: 'center' });
      for (const element of document.querySelectorAll('*'))
        element.scrollLeft = 0;
    });
    await shoot(page, 'create-agent-form');
  });

test('a failed setup says why, offers Retry, and carries on after it', async ({
  page,
}) => {
  let computers: ComputerStatus[] = [];
  // The fail-fast state's reason, as the API will send it.
  const failedWithReason = { ...computer, status: 'failed' as const };
  Reflect.set(failedWithReason, 'failureReason', 'The host ran out of disk.');
  await page.route('**/auth/team/computers', async (route) => {
    if (route.request().method() === 'GET') return json(route, 200, computers);
    computers = [failedWithReason];
    return json(route, 200, { computerId: 'computer-1', state: 'ready' });
  });
  await page.route('**/auth/team/computers/offers', (route) =>
    json(route, 200, offers)
  );
  await page.route('**/auth/team/computers/*/retry', (route) => {
    computers = [computer];
    return json(route, 200, computer);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Get a computer' }).click();
  await dialog(page)
    .getByRole('button', { name: 'Buy · $40.00/month' })
    .click();

  const progress = dialog(page).getByRole('list', { name: 'Setup progress' });
  const stuck = progress.getByRole('listitem').nth(1);
  await expect(stuck).toContainText(
    'The host ran out of disk. The computer could not be set up'
  );
  await expect(
    page.locator('[data-runtime-row="Maya\'s Agent Box"]')
  ).toContainText('Failed');
  await shoot(page, 'setup-failed');

  await stuck.getByRole('button', { name: 'Retry setup' }).click();
  await expect(stuck).not.toContainText('could not be set up', {
    timeout: 10_000,
  });
  await expect(stuck).toContainText(/Creating the computer\s*\d+:\d\d/);
});

test('a team without a paid plan is told so and sent to Billing', async ({
  page,
}) => {
  let calls = 0;
  await openBuyFlow(page, (route) => {
    calls++;
    return json(route, 422, { message: 'the team has no active subscription' });
  });
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toBeVisible();
  await shoot(page, 'error-no-plan');
  await expect(alert).toHaveText(
    'Computers need a paid Macro plan. Your team does not have one yet.'
  );
  // A 422 is final: no retries, and no retry offered.
  expect(calls).toBe(1);
  await expect(dialog(page).getByRole('button', { name: 'Retry' })).toHaveCount(
    0
  );
  await dialog(page).getByRole('button', { name: 'Go to Billing' }).click();
  expect(
    await page.evaluate(() => window.computerFixture.settingsOpened())
  ).toBe('Billing');
});

test('a trialing team is told computers come after the trial', async ({
  page,
}) => {
  await openBuyFlow(page, (route) =>
    json(route, 403, {
      message: 'Computers are available on paid plans.',
      code: 'team_on_trial',
    })
  );
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toBeVisible();
  await shoot(page, 'error-trial');
  await expect(alert).toHaveText(
    'Computers can be added once your trial ends and your team is on a paid plan.'
  );
  await expect(
    dialog(page).getByRole('button', { name: 'Go to Billing' })
  ).toBeVisible();
});

test('an account outside the rollout is told computers are not available to it', async ({
  page,
}) => {
  await openBuyFlow(page, (route) =>
    json(route, 403, { message: 'computers are not enabled for this team' })
  );
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toBeVisible();
  await shoot(page, 'error-rollout');
  await expect(alert).toHaveText(
    "Computers aren't available for this account yet."
  );
});

test('computers being unavailable, and a billing provider failure, each read as what they are', async ({
  page,
}) => {
  let status = 503;
  let calls = 0;
  await openBuyFlow(page, (route) => {
    calls++;
    return json(route, status, { message: 'upstream' });
  });
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toHaveText(
    "Computers aren't available right now. Try again later."
  );
  await shoot(page, 'error-unavailable');
  // One retry on a 5xx, never more.
  expect(calls).toBe(2);

  status = 502;
  await dialog(page).getByRole('button', { name: 'Retry' }).click();
  await expect(alert).toHaveText(
    "Macro's billing provider didn't answer. Try again in a moment."
  );
  await shoot(page, 'error-provider');
});

test('a dropped connection says so and Retry loads the sizes', async ({
  page,
}) => {
  let failing = true;
  await openBuyFlow(page, (route) =>
    failing ? route.abort('failed') : json(route, 200, offers)
  );
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toHaveText(
    "Couldn't reach Macro. Check your connection and try again."
  );
  await shoot(page, 'error-network');

  failing = false;
  await dialog(page).getByRole('button', { name: 'Retry' }).click();
  await expect(
    dialog(page).getByRole('radio', { name: 'Large' })
  ).toBeVisible();
});

test('a request that never answers times out instead of spinning forever', async ({
  page,
}) => {
  test.setTimeout(90_000);
  let hanging = true;
  await openBuyFlow(page, async (route) => {
    if (!hanging) return json(route, 200, offers);
    // Never answered; the client gives up first.
    await new Promise<void>((resolve) => setTimeout(resolve, 40_000));
    return route.abort('timedout');
  });
  const alert = dialog(page).getByRole('alert');
  await expect(alert).toHaveText(
    'Loading computer sizes took too long. Try again.',
    { timeout: 40_000 }
  );
  await shoot(page, 'error-timeout');

  hanging = false;
  await dialog(page).getByRole('button', { name: 'Retry' }).click();
  await expect(
    dialog(page).getByRole('radio', { name: 'Large' })
  ).toBeVisible();
});
