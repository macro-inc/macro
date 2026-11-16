import { expect, test } from '@playwright/test';

for (const field of ['email', 'name', 'row_id']) {
  test(`refuses unsupported ${field} joins rather than returning an empty result`, async ({
    page,
  }) => {
    await page.goto('/?sql-people&joins');
    await expect(page.getByTestId('join-result')).toContainText(
      'Late private name',
      { timeout: 20000 }
    );
    await expect(page.getByTestId('join-reads')).toHaveText('1');
    await page
      .getByRole('textbox', { name: 'SQL', exact: true })
      .fill(
        `SELECT p.name FROM fixture.rows r JOIN macro.people p ON r.${field} = p.${field}`
      );
    await expect(page.getByTestId('join-error')).toHaveText('rejected');
    await expect(page.getByTestId('join-result')).not.toHaveText('[]');
    await expect(page.getByTestId('join-reads')).toHaveText('1');
    // A rejected shape must not poison a later supported identity join.
    await page
      .getByRole('textbox', { name: 'SQL', exact: true })
      .fill(
        'SELECT p.email FROM fixture.rows r JOIN macro.people p ON r.owner = p.id'
      );
    await expect(page.getByTestId('join-error')).toBeEmpty();
    await expect(page.getByTestId('join-result')).toContainText(
      'late@example.com'
    );
    await expect(page.getByTestId('join-reads')).toHaveText('2');
  });
}
