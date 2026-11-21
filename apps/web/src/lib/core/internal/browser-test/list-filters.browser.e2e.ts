import { expect, test } from '@playwright/test';
import { scrollList } from './scroll-gesture';

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
    // Reaching the end of the list reads the next page, listed below.
    const requests = Number(await page.getByTestId('requests').textContent());
    if (phone)
      await page
        .getByRole(role, { name: /Person 49/ })
        .first()
        .scrollIntoViewIfNeeded();
    else await scrollList(page.getByRole('listbox'));
    const next = page.getByRole(role, { name: /Person 50/ }).first();
    await expect(next).toBeAttached();
    await expect(page.getByTestId('requests')).toHaveText(String(requests + 1));
    if (phone) await next.scrollIntoViewIfNeeded();
    else await scrollList(page.getByRole('listbox'), 150);
    await expect(next).toBeInViewport();
    await expect(
      page.getByRole(phone ? 'button' : 'option', { name: 'Next options' })
    ).toHaveCount(0);
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
