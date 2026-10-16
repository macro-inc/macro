import { expect, test } from '@playwright/test';
import { fixtureConnectorIcon } from '../tests/connector-icons';
import {
  accentSwatch,
  expectLanded,
  fakeEvents,
  fakeWorld,
  heading,
  openFixture,
} from './fixture-page';

test('a new user signs up, connects everything, and starts the trial', async ({
  page,
}) => {
  await openFixture(page, '/?view=signup', { viewer: null });

  await expect(heading(page, 'Create your workspace')).toBeVisible();
  await accentSwatch(page, 'Coral').click();
  await expect(page.getByRole('radio', { name: 'Coral' })).toBeChecked();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(
    heading(page, 'Which features do you want to try first?')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    heading(page, 'A workspace built to earn your trust.')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Google sign-up leaves the page; the account exists when it returns.
  await page.getByRole('button', { name: 'Connect work email' }).click();
  await expect(heading(page, /Connect your work/)).toBeVisible();
  expect((await fakeWorld(page)).accent).toBe('#f77d67');

  // Inbox OAuth is a full-page round-trip back into the same step.
  await page.getByRole('button', { name: 'Connect work email' }).click();
  await expect(page.getByText('ada@acme.com')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(heading(page, /Add your personal/)).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  await expect(heading(page, 'Connect your tools.')).toBeVisible();
  await page.getByLabel('Search integrations and MCPs').fill('lin');
  await expect(page.getByRole('button', { name: /Notion/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect Linear' }).click();
  await expect(
    page.getByRole('button', { name: 'Connected to Linear' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(heading(page, 'Built for teams.')).toBeVisible();
  await expect(page.locator('#team-name')).toHaveValue('Acme');
  await expect(page.getByLabel('Teammate 1 email')).toHaveValue(
    'grace@acme.com'
  );
  await page.getByRole('button', { name: 'Create team & invite 2' }).click();

  await expect(heading(page, 'Free Claude & GPT for 30 days.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start 30 day trial' }).click();

  // Stripe returns on the success leg; the flow waits for the webhook's license.
  await expectLanded(page, 'Entered Macro at /home');
  const world = await fakeWorld(page);
  expect(world.viewer).toMatchObject({
    tutorialComplete: true,
    licensed: true,
  });
  expect(world.teams).toEqual([{ name: 'Acme' }]);
  expect(world.connectedTools).toEqual(['linear']);
});

test('a deep link survives the inbox OAuth round-trip', async ({ page }) => {
  await openFixture(page, '/?view=flow&next=/channel/launch');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Connect work email' }).click();
  await expect(page.getByText('ada@acme.com')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('next')).toBeNull();

  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Continue with Free' }).last().click();

  await expectLanded(page, 'Entered Macro at /channel/launch');
});

test('Free, Pro, and Max appear below the unchanged trial offer', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow&next=/md/notes');
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
    );
  });
  await page.reload();

  await expect(heading(page, 'Free Claude & GPT for 30 days.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start 30 day trial' })
  ).toBeInViewport();
  const comparison = page.getByRole('table', {
    name: 'Compare Free, Pro, and Max plans',
  });
  await expect(comparison).not.toBeInViewport();
  await page.getByRole('button', { name: 'See more' }).click();
  await expect(comparison).toBeInViewport();
  for (const name of ['Free', 'Pro', 'Max']) {
    await expect(
      comparison.getByRole('columnheader', { name: new RegExp(`^${name}`) })
    ).toBeVisible();
  }
  await expect(comparison).toContainText('10× usage');
  await expect(comparison).not.toContainText('at cost');
  await page.getByRole('button', { name: 'Continue with Pro' }).click();
  await expect(
    page.getByRole('button', { name: 'Start 30 day trial' })
  ).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'See more' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Continue with Free' }).last().click();

  await expectLanded(page, 'Entered Macro at /md/notes');
  expect(await fakeEvents(page)).toContainEqual({
    event: 'onboarding_v4_completed',
    data: expect.objectContaining({ plan: 'free' }),
  });
});

test('Max checkout returns with a licensed account and no trial', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow');
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Max' }).click();
  await expectLanded(page, 'Entered Macro at /home');
  expect((await fakeWorld(page)).viewer).toMatchObject({
    tutorialComplete: true,
    licensed: true,
  });
  expect(await fakeEvents(page)).toContainEqual({
    event: 'onboarding_v4_completed',
    data: expect.objectContaining({ plan: 'max' }),
  });
});

test('cancelling checkout returns to a retryable trial offer', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow', { checkoutOutcome: 'cancel' });
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start 30 day trial' }).click();

  await expect(page).toHaveURL(/subscriptionCancel=true/);
  await expect(
    page.getByRole('button', { name: 'Start 30 day trial' })
  ).toBeEnabled();
  expect((await fakeWorld(page)).viewer?.tutorialComplete).toBe(false);
});

test('an ineligible trial explains itself instead of charging', async ({
  page,
}) => {
  const message =
    'The 30-day trial is only available for your first Premium subscription';
  await openFixture(page, '/?view=flow', { failures: { checkout: message } });
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start 30 day trial' }).click();

  await expect(page.getByRole('status', { name: 'Notifications' })).toHaveText(
    'The 30-day trial is only available for your first Pro subscription'
  );
  await expect(
    page.getByRole('button', { name: 'Start 30 day trial' })
  ).toBeEnabled();
  await expect(page).not.toHaveURL(/subscription/);
});

test('an invite’s free months replace the trial and keep its promotion', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow', {
    inviteOffer: {
      firstName: 'Ada',
      freeMonths: 3,
      linkId: 'link-1',
      promoCode: 'ADA3',
      redeemedAt: '2026-10-01T00:00:00Z',
    },
  });
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
    );
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Start 30 day trial' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Claim your free months' }).click();
  await expectLanded(page, 'Entered Macro at /home');
  expect((await fakeWorld(page)).viewer?.licensed).toBe(true);
});

test('an existing team member just confirms and moves on', async ({ page }) => {
  await openFixture(page, '/?view=flow', { teams: [{ name: 'Acme' }] });
  await page.evaluate(() => {
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'team' })
    );
  });
  await page.reload();
  await expect(page.getByText("You're on Acme")).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(heading(page, 'Free Claude & GPT for 30 days.')).toBeVisible();
});

test('staff can bypass onboarding from any step', async ({ page }) => {
  await openFixture(page, '/?view=flow', {
    viewer: {
      id: 'macro|wolf@macro.com',
      email: 'wolf@macro.com',
      tutorialComplete: false,
      licensed: false,
    },
  });
  await expect(heading(page, 'Create your workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Bypass' }).click();
  await expectLanded(page, 'Entered Macro at /home');
  expect((await fakeWorld(page)).record.status).toBe('completed');
});

test('a finished user is sent straight into the app', async ({ page }) => {
  await openFixture(page, '/?view=flow&next=/md/doc', {
    viewer: {
      id: 'macro|ada@acme.com',
      email: 'ada@acme.com',
      tutorialComplete: true,
      licensed: false,
    },
  });
  await expectLanded(page, 'Entered Macro at /md/doc');
});

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('a click lands as soon as the next slide appears, not after its animation', async ({
    page,
  }) => {
    await openFixture(page, '/?view=signup', { viewer: null });
    const steps: [string, string | RegExp][] = [
      ['Get started', 'Which features do you want to try first?'],
      ['Continue', 'A workspace built to earn your trust.'],
      ['Continue', /Connect your work/],
    ];
    await expect(heading(page, 'Create your workspace')).toBeVisible();
    for (const [button, next] of steps) {
      // A person clicks once the slide is visible, well before its flight ends.
      await page.waitForTimeout(400);
      const box = await page
        .getByRole('button', { name: button })
        .last()
        .boundingBox();
      if (!box) throw new Error(`${button} is not on screen`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(heading(page, next)).toBeVisible({ timeout: 1_000 });
    }
  });

  test('the story handoffs finish and leave the next step interactive', async ({
    page,
  }) => {
    await openFixture(page, '/?view=flow');
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(
      heading(page, 'Which features do you want to try first?')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      heading(page, 'A workspace built to earn your trust.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('button', { name: 'Connect work email' })
    ).toBeEnabled();
    await expect(page.locator('[inert]')).toHaveCount(0);
  });
});

test.describe('on a phone-sized screen', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

  test('the steps fit without horizontal scrolling', async ({ page }) => {
    await openFixture(page, '/?view=flow');
    for (const next of ['Get started', 'Continue', 'Continue']) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: next }).click();
    }
    await expect(heading(page, /Connect your work/)).toBeVisible();
  });
});

for (const width of [1440, 390]) {
  for (const theme of ['cream', 'dark'] as const) {
    test(`${theme} onboarding stays readable across all steps at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page, `/?view=flow&theme=${theme}`);
      const background =
        theme === 'cream' ? 'rgb(245, 241, 232)' : 'rgb(0, 0, 0)';
      const ink = theme === 'cream' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      for (const step of [
        'welcome',
        'vision',
        'security',
        'work',
        'personal',
        'tools',
        'team',
        'plan',
      ]) {
        await page.evaluate((step) => {
          sessionStorage.setItem(
            'onboarding-flow-step',
            JSON.stringify({ user: 'macro|ada@acme.com', step })
          );
        }, step);
        await page.reload();
        await expect(page.locator('.onboarding-flow')).toHaveCSS(
          'background-color',
          background
        );
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toHaveCSS(
          'color',
          ink
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
      }
      // The explicit palette also survives a simulated Google redirect that drops query params.
      await page.evaluate(() =>
        sessionStorage.setItem(
          'onboarding-flow-step',
          JSON.stringify({ user: 'macro|ada@acme.com', step: 'work' })
        )
      );
      await page.reload();
      await page.getByRole('button', { name: 'Connect work email' }).click();
      await expect(page.getByText('ada@acme.com')).toBeVisible();
      await expect(page.locator('.onboarding-flow')).toHaveCSS(
        'background-color',
        background
      );
    });
  }
}

test('system theme changes keep the current onboarding step and selected accent', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openFixture(page, '/?view=flow');
  await accentSwatch(page, 'Coral').click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(
    heading(page, 'Which features do you want to try first?')
  ).toBeVisible();
  await expect(page.locator('.onboarding-flow')).toHaveCSS(
    'background-color',
    'rgb(245, 241, 232)'
  );
  expect((await fakeWorld(page)).accent).toBe('#f77d67');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(
    heading(page, 'Which features do you want to try first?')
  ).toBeVisible();
  await expect(page.locator('.onboarding-flow')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)'
  );
});

test('tools keep Drive and Sheets, hide excluded Google apps and preserve native connections', async ({
  page,
}, testInfo) => {
  await openFixture(page, '/?view=flow&theme=cream', {
    catalog: [
      ['gmail', 'Gmail'],
      ['google_sheets', 'Google Sheets'],
      ['google_drive', 'Google Drive'],
      ['google_calendar', 'Google Calendar'],
      ['linear', 'Linear'],
      ['notion', 'Notion'],
      ['mysql', 'MySQL'],
      ['supabase', 'Supabase'],
      ['quickbooks', 'QuickBooks'],
      ['stripe', 'Stripe'],
      ['posthog', 'PostHog'],
      ['github', 'GitHub'],
      ['figma', 'Figma'],
      ['intercom', 'Intercom'],
      ['hubspot', 'HubSpot'],
      ['airtable_oauth', 'Airtable'],
      ['xero_accounting_api', 'Xero'],
      ['shopify', 'Shopify'],
      ['mailchimp', 'Mailchimp'],
      ['zendesk', 'Zendesk'],
      ['calendly_v2', 'Calendly'],
      ['asana', 'Asana'],
      ['trello', 'Trello'],
      ['slack', 'Slack'],
      ['slack_v2', 'Slack'],
      ['linear', 'Linear'],
    ].map(([slug, name]) => ({
      slug,
      name,
      iconUrl: fixtureConnectorIcon(slug),
    })),
    nativeTools: [
      {
        url: 'https://mcp.linear.app/mcp/',
        server_name: 'My issues',
        authenticated: true,
        enabled: true,
      },
    ],
  });
  await page.evaluate(() =>
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'tools' })
    )
  );
  await page.reload();
  await expect(heading(page, 'Connect your tools.')).toBeVisible();
  for (const name of ['Gmail', 'Google Calendar']) {
    await expect(
      page.getByRole('button', { name: `Connect ${name}`, exact: true })
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole('button', { name: 'Connected to Linear' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connect Notion' })
  ).toBeEnabled();
  const cards = page
    .getByRole('region', { name: 'Available integrations' })
    .getByRole('button');
  await expect(cards).toHaveCount(22);
  expect(
    await cards.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label'))
    )
  ).toEqual([
    'Connected to Linear',
    'Connect Notion',
    'Connect Slack',
    'Connect PostHog',
    'Connect Stripe',
    'Connect GitHub',
    'Connect Figma',
    'Connect Intercom',
    'Connect HubSpot',
    'Connect Airtable',
    'Connect QuickBooks',
    'Connect Xero',
    'Connect Shopify',
    'Connect Mailchimp',
    'Connect Zendesk',
    'Connect Calendly',
    'Connect Asana',
    'Connect Trello',
    'Connect Google Sheets',
    'Connect Google Drive',
    'Connect MySQL',
    'Connect Supabase',
  ]);
  // Exercise directory logos, including apps without a bundled native icon.
  await expect(cards.locator('img')).toHaveCount(21);
  await expect(
    page
      .getByRole('button', { name: 'Connect Notion', exact: true })
      .locator('img')
  ).toHaveCSS('filter', /invert\(0\)/);
  const stripeIcon = page
    .getByRole('button', { name: 'Connect Stripe', exact: true })
    .locator('img');
  await expect
    .poll(() =>
      stripeIcon.evaluate((image: HTMLImageElement) => image.naturalWidth)
    )
    .toBeGreaterThan(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter(
          (image) => image.getBoundingClientRect().top < window.innerHeight
        )
        .map((image) => image.decode())
    );
  });
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('onboarding-connectors-fixed.png'),
  });
  await page.getByRole('searchbox').fill('MySQL');
  await expect(
    page.getByRole('button', { name: 'Connect MySQL', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect Slack', exact: true })
  ).toHaveCount(0);
  await page.getByRole('searchbox').fill('Google');
  await expect(
    page.getByRole('button', { name: /Connect Google/ })
  ).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Connect Google Drive', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect Google Sheets', exact: true })
  ).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('onboarding-google-search.png'),
  });
  await page.getByRole('searchbox').fill('Notion');
  await page.getByRole('button', { name: 'Connect Notion' }).click();
  await expect(
    page.getByRole('button', { name: 'Connected to Notion' })
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Connected to Linear' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Connected to Notion' })
  ).toBeDisabled();
});

for (const githubLinkStatus of [
  'unlinked',
  'reauthentication_required',
] as const) {
  test(`GitHub uses native account linking from ${githubLinkStatus} and returns to tools`, async ({
    page,
  }) => {
    await openFixture(page, '/?view=flow', {
      githubLinkStatus,
      connectedTools: ['github'],
      nativeTools: [
        {
          url: 'https://api.githubcopilot.com/mcp',
          authenticated: true,
          enabled: true,
          server_name: 'GitHub MCP',
        },
      ],
    });
    await page.evaluate(() =>
      sessionStorage.setItem(
        'onboarding-flow-step',
        JSON.stringify({ user: 'macro|ada@acme.com', step: 'tools' })
      )
    );
    await page.reload();
    await expect(heading(page, 'Connect your tools.')).toBeVisible();
    await page
      .getByRole('button', { name: 'Connect GitHub', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Account linked to GitHub',
        exact: true,
      })
    ).toBeDisabled();
    await expect(heading(page, 'Connect your tools.')).toBeVisible();
    expect((await fakeWorld(page)).githubLinkStatus).toBe('linked');
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: 'Account linked to GitHub',
        exact: true,
      })
    ).toBeDisabled();
  });
}

test('connection status failure leaves native GitHub available', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow', { connectionFailures: ['pipedream'] });
  await page.evaluate(() =>
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'tools' })
    )
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Connect GitHub', exact: true })
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Connect Notion', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Retry connection status' })
  ).toBeVisible();
});

test('enables an existing native tool without reconnecting', async ({
  page,
}) => {
  await openFixture(page, '/?view=flow', {
    nativeTools: [
      {
        url: 'https://mcp.linear.app/mcp',
        server_name: 'Linear',
        authenticated: true,
        enabled: false,
      },
    ],
  });
  await page.evaluate(() =>
    sessionStorage.setItem(
      'onboarding-flow-step',
      JSON.stringify({ user: 'macro|ada@acme.com', step: 'tools' })
    )
  );
  await page.reload();
  await page
    .getByRole('button', { name: 'Enable Linear', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Connected to Linear', exact: true })
  ).toBeDisabled();
  expect((await fakeWorld(page)).connectedTools).toEqual([]);
  expect((await fakeWorld(page)).nativeTools[0].enabled).toBe(true);
});

for (const width of [1280, 390]) {
  test(`returning customer buys Pro without a trial at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFixture(page, '/?view=flow', { trialEligible: false });
    await page.evaluate(() => {
      sessionStorage.setItem(
        'onboarding-flow-step',
        JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
      );
    });
    await page.reload();
    await expect(heading(page, 'Get more with Pro.')).toBeVisible();
    await expect(page.getByText('Free Claude & GPT for 30 days.')).toHaveCount(
      0
    );
    await expect(
      page.getByRole('button', { name: 'Start 30 day trial' })
    ).toHaveCount(0);
    await expect(
      page.getByText('30 days free, then', { exact: false })
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Get Pro', exact: true }).click();
    await expectLanded(page, 'Entered Macro at /home');
  });
}

test.describe('subscription recovery', () => {
  test.use({ hasTouch: true });
  for (const width of [1280, 390]) {
    test(`existing subscription opens management without replacement at ${width}px${width === 390 ? ' after eligibility fails' : ''}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openFixture(page, '/?view=flow', {
        trialEligible: false,
        existingSubscription: true,
        failures: width === 390 ? { trialEligibility: 'offline' } : {},
      });
      await page.evaluate(() =>
        sessionStorage.setItem(
          'onboarding-flow-step',
          JSON.stringify({ user: 'macro|ada@acme.com', step: 'plan' })
        )
      );
      await page.reload();
      await expect(heading(page, 'Manage your subscription.')).toBeVisible();
      await expect(
        page.getByText('30 days free, then', { exact: false })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Continue with Pro', exact: true })
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Continue with Max', exact: true })
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Manage subscription', exact: true })
        .tap();
      const calls = await page.evaluate(() => window.onboardingFixture.calls());
      expect(calls).toContain('manageSubscription');
      expect(calls.some((call) => call.startsWith('checkout:'))).toBe(false);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    });
  }
});
