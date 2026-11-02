import { expect, test } from '@playwright/test';

test('creates a named company without inventing a domain', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New company', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Company name' })
    .fill('Community group');
  await page.screenshot({ path: testInfo.outputPath('name-only-company.png') });
  await page.getByRole('button', { name: /^Create Company/ }).click();
  await expect(page.getByTestId('created')).toHaveText(
    '{"name":"Community group"}'
  );
});

for (const company of ['Acme', 'Community group']) {
  test(`creates a personal-email contact at ${company}`, async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'New contact', exact: true })
      .click();
    await page.getByRole('textbox', { name: 'Contact name' }).fill('Jane');
    await page
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('Jane@other.example.com');
    await page
      .getByRole('button', { name: 'Choose a company', exact: true })
      .click();
    await page.getByRole('option', { name: new RegExp(company) }).click();
    await page.screenshot({
      path: testInfo.outputPath('personal-email-contact.png'),
    });
    await page.getByRole('button', { name: /^Create Contact/ }).click();
    await expect(page.getByTestId('created')).toHaveText(
      JSON.stringify({
        companyId: company === 'Acme' ? 'acme' : 'name-only',
        name: 'Jane',
        email: 'jane@other.example.com',
      })
    );
  });
}

test('creates a contact by name alone, without a company or email', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New contact', exact: true }).click();
  await page.getByRole('textbox', { name: 'Contact name' }).fill('Jane Doe');
  await page.screenshot({ path: testInfo.outputPath('name-only-contact.png') });
  await page.getByRole('button', { name: /^Create Contact/ }).click();
  await expect(page.getByTestId('created')).toHaveText('{"name":"Jane Doe"}');
});

test('creates a name-only company while adding a deal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New deal', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Find or add a company' })
    .fill('New group');
  await page.getByRole('option', { name: 'Add company “New group”' }).click();
  await page.getByRole('button', { name: /^Add deal/ }).click();
  await expect(page.getByTestId('created')).toHaveText('{"name":"New group"}');
});

test('selects a different company for a pipeline contact', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New pipeline contact', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Find or add a contact' })
    .fill('jane@example.com');
  await page
    .getByRole('option', { name: 'Add contact “jane@example.com”' })
    .click();
  await page.getByRole('textbox', { name: 'Contact name' }).fill('Jane');
  await page
    .getByRole('button', { name: 'Choose a company', exact: true })
    .click();
  await page.getByRole('option', { name: /Community group/ }).click();
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('jane@other.example.com');
  await page.getByRole('button', { name: /^Add contact/ }).click();
  await expect(page.getByTestId('created')).toHaveText(
    '{"companyId":"name-only","name":"Jane","email":"jane@other.example.com"}'
  );
});

test('requires accepting a suggested company before creating a pipeline contact', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'New pipeline contact', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Find or add a contact' })
    .fill('jane@example.com');
  await page
    .getByRole('option', { name: 'Add contact “jane@example.com”' })
    .click();
  await page.getByRole('textbox', { name: 'Contact name' }).fill('Jane');
  await page.getByRole('button', { name: /^Add contact/ }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Choose a company for this contact'
  );
  await expect(page.getByTestId('created')).toBeEmpty();
  await page
    .getByRole('button', { name: 'Use suggested company: Acme', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill('jane@other.example.com');
  await page.getByRole('button', { name: /^Add contact/ }).click();
  await expect(page.getByTestId('created')).toHaveText(
    '{"companyId":"acme","name":"Jane","email":"jane@other.example.com"}'
  );
});
