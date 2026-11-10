import { expect, test } from '@playwright/test';

for (const native of [false, true]) {
  test(`fresh sign-in uses the ${native ? 'native hash' : 'web'} login route`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      `/src/features/passwords/browser-test/vault.html?reauth=1${native ? '&native=1' : ''}`
    );
    await page
      .getByRole('button', { name: 'New item', exact: true })
      .last()
      .click();
    await page.getByLabel('Name', { exact: true }).fill('Credential');
    await page.getByLabel('Password', { exact: true }).fill('synthetic');
    await page
      .getByRole('button', { name: 'Save', exact: true })
      .first()
      .click();
    await page
      .getByRole('button', { name: 'Reveal password', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Sign in again', exact: true })
      .click();
    await expect(page.getByTestId('login-intent')).toHaveText(
      'true:/passwords'
    );
    const destination = new URL(page.url());
    expect(native ? destination.hash.split('?')[0] : destination.pathname).toBe(
      native ? '#/login' : '/app/login'
    );
    expect(errors).toEqual([]);
  });
}
