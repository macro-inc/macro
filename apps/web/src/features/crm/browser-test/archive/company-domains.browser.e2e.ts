import { expect, test } from '@playwright/test';

// Production controls and mutation with synthetic transport responses;
// these checks do not establish hosted persistence.
test('a company domain is added, refused when another company has it, and removed', async ({
  page,
}, info) => {
  await page.goto('/?kind=company');
  // The header and Record details render the same field.
  const domains = page
    .getByLabel('Company details', { exact: true })
    .getByRole('group', { name: 'Domains', exact: true });
  await expect(domains.getByText('example.com', { exact: true })).toBeVisible();

  await domains
    .getByRole('button', { name: 'Add domain', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: 'Domain', exact: true });
  await input.fill('Example.org');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(input).toBeHidden();
  await expect(domains.getByText('example.org', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.archiveFixture.snapshot().company.domains.map((d) => d.domain)
    )
  ).toEqual(['example.com', 'example.org']);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('domain-added.png'),
  });

  await domains
    .getByRole('button', { name: 'Add domain', exact: true })
    .click();
  await input.fill('example.net');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Second company already has this domain. Remove it there first.'
  );
  await expect(input).toHaveValue('example.net');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('domain-taken.png'),
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await domains
    .getByRole('button', {
      name: 'Domain options for example.com',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The company is named after this domain. Rename the company first.'
  );
  await page.keyboard.press('Escape');

  await domains
    .getByRole('button', {
      name: 'Domain options for example.org',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(domains.getByText('example.org', { exact: true })).toBeHidden();
  expect(
    await page.evaluate(() =>
      window.archiveFixture.snapshot().company.domains.map((d) => d.domain)
    )
  ).toEqual(['example.com']);
});
