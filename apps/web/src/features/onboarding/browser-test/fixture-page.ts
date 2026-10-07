import { expect, type Page } from '@playwright/test';
import type { FakeOnboardingWorld } from '../tests/fake-onboarding-context';
import { FIXTURE_KEYS } from './fixture-keys';

/** Open the fixture with `seed` merged over the default fake world. */
export async function openFixture(
  page: Page,
  path: string,
  seed: Partial<FakeOnboardingWorld> & { checkoutOutcome?: 'cancel' } = {}
) {
  page.on('pageerror', (error) => {
    throw error;
  });
  const { checkoutOutcome, ...world } = seed;
  // Init scripts rerun on every load; only the first may seed, or reloads
  // after OAuth/Stripe would reset the fake backend.
  await page.addInitScript(
    ([keys, world, outcome]) => {
      if (sessionStorage.getItem(keys.seed) !== null) return;
      sessionStorage.setItem(keys.seed, JSON.stringify(world));
      if (outcome) sessionStorage.setItem(keys.checkoutOutcome, outcome);
    },
    [FIXTURE_KEYS, world, checkoutOutcome] as const
  );
  await page.goto(path);
}

export const fakeWorld = (page: Page) =>
  page.evaluate(() => window.onboardingFixture.world());

export const fakeEvents = (page: Page) =>
  page.evaluate(() => window.onboardingFixture.events());

export async function expectLanded(page: Page, text: string) {
  await expect(page.getByTestId('landed')).toHaveText(text);
}

/** The visible swatch; its radio is visually hidden inside the label. */
export const accentSwatch = (page: Page, name: string) =>
  page.locator('label').filter({ has: page.getByRole('radio', { name }) });

export const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });
