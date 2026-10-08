import { expect, type Page } from '@playwright/test';
import type { FakeAuthWorld } from '../tests/fake-auth-context';
import { FIXTURE_KEYS } from './fixture-keys';

/** Open the fixture with `seed` merged over the default fake auth world. */
export async function openFixture(
  page: Page,
  path: string,
  seed: Partial<FakeAuthWorld> & { ssoEmail?: string } = {}
) {
  page.on('pageerror', (error) => {
    throw error;
  });
  const { ssoEmail, ...world } = seed;
  // Init scripts rerun on every load; only the first may seed, or the SSO
  // round-trip would reset the fake backend.
  await page.addInitScript(
    ([keys, world, ssoEmail]) => {
      if (sessionStorage.getItem(keys.seed) !== null) return;
      sessionStorage.setItem(keys.seed, JSON.stringify(world));
      if (ssoEmail) sessionStorage.setItem(keys.ssoEmail, ssoEmail);
    },
    [FIXTURE_KEYS, world, ssoEmail] as const
  );
  await page.goto(path);
}

export const fakeAuth = (page: Page) =>
  page.evaluate(() => window.authFixture.auth());

export const fakeCalls = (page: Page) =>
  page.evaluate(() => window.authFixture.calls());

export async function expectLanded(page: Page, target: string) {
  await expect(page.getByTestId('landed')).toHaveText(
    `Entered Macro at ${target}`
  );
}

export async function signInWithCode(page: Page, email: string, code: string) {
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel('One-time code').fill(code);
}
