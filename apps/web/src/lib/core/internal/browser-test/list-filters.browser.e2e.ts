import { expect, test } from '@playwright/test';

for (const view of ['drive', 'notes']) {
  test(`${view} people filters keep selections across bounded search and pages`, async ({
    page,
  }, info) => {
    const phone = info.project.name === 'phone';
    await page.goto(`/?list-filters=${view}`);
    await expect(page.getByTestId('requests')).toHaveText('0');
    const label = phone
      ? view === 'drive'
        ? 'Open file filters'
        : 'Open Notes filters'
      : view === 'drive'
        ? 'Filter files'
        : 'Filter Notes';
    await page.getByRole('button', { name: label, exact: true }).click();
    if (phone) {
      // Notes opens its first (people) section; Drive opens Type instead.
      if (view === 'drive') {
        await expect(page.getByTestId('requests')).toHaveText('0');
        await page.getByRole('button', { name: /Created by/ }).click();
      }
    } else
      await page
        .getByRole('menuitem', { name: 'Created by', exact: true })
        .click();
    const input = page.getByPlaceholder('Search creators...');
    await expect(input).toBeVisible();
    const role = phone ? 'checkbox' : 'option';
    await expect(
      page.getByRole(role, { name: /Selected Person/ }).first()
    ).toBeVisible();
    await expect(
      page.getByRole(role, { name: /unavailable-person/ }).first()
    ).toBeVisible();
    await expect(
      page.getByRole(role, { name: /Viewer \(me\)/ }).first()
    ).toBeVisible();
    if (!phone)
      await page.getByRole('listbox').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    await page
      .getByRole(phone ? 'button' : 'option', {
        name: 'Next options',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole(role, { name: /Person 50/ }).first()
    ).toBeInViewport();
    await expect(page.getByTestId('selected-ids')).toContainText(
      'unavailable-person'
    );
    await input.fill('zxq');
    const match = page.getByRole(role, { name: 'Broader match', exact: true });
    await expect(match).toBeVisible();
    if (phone) await match.click();
    else await match.locator('[data-multiselect-checkbox]').click();
    await expect(page.getByTestId('selected-ids')).toContainText(
      'macro|match@example.com'
    );
    await expect(page.getByTestId('selected-ids')).toContainText(
      'unavailable-person'
    );
    if (!phone) {
      await match.hover();
      await match
        .getByRole('button', { name: 'Select only Broader match' })
        .click();
      await expect(page.getByTestId('selected-ids')).toHaveText(
        '["macro|match@example.com"]'
      );
      await expect(input).toBeFocused();
    }
    await expect(page.getByTestId('facets')).toContainText(
      view === 'drive' ? 'file-pdf' : 'retained-tag'
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  });
}
