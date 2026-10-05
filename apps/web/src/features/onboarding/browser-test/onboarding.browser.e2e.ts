import { expect, test } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Continue as Guest' }).last().click();

  await expectLanded(page, 'Entered Macro at /channel/launch');
});

test('Guest continuation lives in the comparison below the trial offer', async ({
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

  await page.getByRole('button', { name: 'Continue as Guest' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Choose what works for you.' })
  ).toBeInViewport();
  await expect(page.getByRole('table')).toContainText('Haiku');
  await page.getByRole('button', { name: 'Continue as Guest' }).last().click();

  await expectLanded(page, 'Entered Macro at /md/notes');
  expect(await fakeEvents(page)).toContainEqual({
    event: 'onboarding_v4_completed',
    data: expect.objectContaining({ plan: 'free' }),
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
    message
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
