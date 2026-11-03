import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`real action handoff, filters, dismissal and preferences in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);
    await expect(page.locator('[data-feed-item]')).toHaveCount(5);
    await expect(page.locator('[data-feed-item]').nth(0)).toHaveAttribute(
      'data-feed-item',
      'reply-needed'
    );
    await expect(page.locator('[data-feed-item]').nth(1)).toHaveAttribute(
      'data-feed-item',
      'account-agent'
    );
    await expect(
      page.getByText('Email thread: Re: Project conversation', { exact: true })
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`for-you-${theme}.png`),
    });
    await page
      .getByRole('button', { name: 'Create agent', exact: true })
      .click();
    await expect(page.getByLabel('Opened action')).toContainText(
      'Create an agent that researches accounts'
    );
    await page
      .getByRole('button', { name: 'Build database', exact: true })
      .click();
    await expect(page.getByLabel('Opened action')).toContainText(
      'Build a database for opportunities'
    );
    await page
      .getByRole('radiogroup', { name: 'Filter your feed' })
      .getByText('Save money', { exact: true })
      .click();
    await expect(page.locator('[data-feed-item]')).toHaveCount(2);
    await expect(
      page.locator('[data-feed-item="weekly-routine"]')
    ).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Filter your feed' })
      .getByText('Make money', { exact: true })
      .click();
    await expect(page.locator('[data-feed-item]')).toHaveCount(2);
    await expect(
      page.locator('[data-feed-item="account-agent"]')
    ).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Filter your feed' })
      .getByText('Ideas', { exact: true })
      .click();
    await expect(page.locator('[data-feed-item]')).toHaveCount(3);
    await page
      .getByRole('radiogroup', { name: 'Filter your feed' })
      .getByText('Important', { exact: true })
      .click();
    await expect(page.locator('[data-feed-item]')).toHaveCount(1);
    await page
      .getByRole('button', { name: 'Open Project conversation', exact: true })
      .click();
    await expect(page.getByLabel('Opened action')).toContainText('test-email');
    await page.getByRole('button', { name: 'Dismiss suggestion' }).click();
    await expect(page.locator('[data-feed-item]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-feed-item]')).toHaveCount(4);
    await page.getByRole('button', { name: 'Tune your feed' }).click();
    await page
      .getByLabel('Your feed prompt')
      .fill('Find useful business databases and routines.');
    await page.getByRole('button', { name: 'Save and refresh' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Tune your feed' }).click();
    await expect(page.getByLabel('Your feed prompt')).toHaveValue(
      'Find useful business databases and routines.'
    );
    expect(errors).toEqual([]);
  });
}

test('generation failure can be retried without showing sample recommendations', async ({
  page,
}) => {
  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toContainText(
    'Your feed couldn’t be updated'
  );
  await expect(page.locator('[data-feed-item]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-feed-item]')).toHaveCount(5);
});

test('shows generation progress before results arrive', async ({ page }) => {
  await page.goto('/?scenario=loading');
  await expect(
    page
      .getByRole('region', { name: 'For you', exact: true })
      .getByRole('status')
  ).toContainText('Finding useful next steps');
  await expect(page.locator('[data-feed-item]')).toHaveCount(0);
});
