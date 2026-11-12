import { expect, test } from '@playwright/test';

for (const mode of ['edit', 'add']) {
  test(`${mode} guests use replaceable windows and retain names and custom addresses`, async ({
    page,
  }, info) => {
    await page.goto(`/?calendar-guests=${mode}`);
    await expect(page.getByTestId('reads')).toHaveText('0');
    await page.getByRole('button', { name: 'Open guests' }).click();
    const input = page.getByPlaceholder('Add guests...');
    await expect(input).toBeVisible();
    if (mode === 'add') {
      await expect(page.getByTestId('excluded')).toContainText(
        'macro|person0@example.com'
      );
      await expect(
        page
          .locator('[data-entity-index]')
          .filter({ hasText: 'Event-owned guest' })
      ).toHaveCount(0);
    }
    await expect(
      page.locator('[data-entity-index]').filter({ hasText: 'Person 000010' })
    ).toBeVisible();
    const tail = page
      .locator('[data-entity-index]')
      .filter({ hasText: mode === 'add' ? 'Person 000050' : 'Person 000049' });
    await tail.scrollIntoViewIfNeeded();
    await expect(tail).toBeInViewport();
    if (info.project.name === 'phone')
      await page.getByRole('button', { name: 'Next options' }).tap();
    else await input.press('PageDown');
    const nextName = mode === 'add' ? 'Person 000051' : 'Person 000050';
    await expect(
      page.locator('[data-entity-index]').filter({ hasText: nextName })
    ).toBeInViewport();
    await page
      .locator('[data-entity-index]')
      .filter({ hasText: nextName })
      .click();
    await input.fill('late');
    await expect(
      page
        .locator('[data-entity-index]')
        .filter({ hasText: 'Private late name' })
        .first()
    ).toBeVisible();
    await input.press('Enter');
    await expect(page.getByTestId('selected')).toContainText(
      'Private late name'
    );
    await expect(page.getByTestId('selected')).toContainText(
      'OUTSIDE@example.org'
    );
    await input.fill('broader');
    const broader = page
      .locator('[data-entity-index]')
      .filter({ hasText: 'Source-approved match' });
    await expect(broader).toBeVisible();
    await broader.click();
    await expect(page.getByTestId('selected')).toContainText(
      'Source-approved match'
    );
    await input.fill('fast@example.org');
    await expect(
      page.getByText('Add fast@example.org', { exact: true })
    ).toBeVisible();
    await input.press('Enter');
    await expect(page.getByTestId('selected')).toContainText(
      'fast@example.org'
    );
    await expect(page.getByTestId('selected')).toContainText(
      'OUTSIDE@example.org'
    );
    await input.fill('custom$@example.org');
    await expect(page.getByTestId('last-read')).toContainText(
      'custom$@example.org'
    );
    await expect(
      page
        .locator('[data-entity-index]')
        .filter({ hasText: 'alias@example.com' })
    ).toHaveCount(0);
    await expect(
      page.getByText('Add custom$@example.org', { exact: true })
    ).toBeVisible();
    await input.press('Enter');
    await expect(page.getByTestId('selected')).toContainText(
      'custom$@example.org'
    );
    await expect(page.getByTestId('selected')).not.toContainText(
      'alias@example.com'
    );
    await expect(page.getByTestId('selected')).toContainText(
      'Private late name'
    );
    await page.getByRole('button', { name: 'Close guests' }).click();
    await page.getByRole('button', { name: 'Open guests' }).click();
    await expect(input).toHaveValue('');
    await expect(page.getByTestId('selected')).toContainText(
      'Private late name'
    );
    if (mode === 'add') {
      await input.fill('PERSON0@example.com');
      await expect(
        page.getByText('Add PERSON0@example.com', { exact: true })
      ).toHaveCount(0);
      await expect(
        page
          .locator('[data-entity-index]')
          .filter({ hasText: 'Event-owned guest' })
      ).toHaveCount(0);
    }
  });
}
