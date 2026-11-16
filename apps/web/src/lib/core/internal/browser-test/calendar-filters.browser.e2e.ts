import { expect, test } from '@playwright/test';

test('keeps selected emails and resolved labels across bounded pages, search and custom entry', async ({
  page,
}) => {
  await page.goto('/?filters');
  const filter = page.getByRole('button', { name: /Filter events/ });
  await filter.click();
  await page.getByRole('menuitem', { name: 'Organizer', exact: true }).click();
  const input = page.getByRole('textbox', {
    name: 'Search organizer contacts',
  });
  await expect(input).toBeFocused();
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Selected Person/ })
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('menuitemcheckbox', { name: /external@example.com/ })
  ).toHaveAttribute('aria-checked', 'true');
  await input.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute(
    'role',
    'menuitemcheckbox'
  );
  await input.click();
  await expect(input).toBeFocused();
  await page
    .getByRole('menuitem', { name: 'Next contacts', exact: true })
    .click();
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Person 50$/ })
  ).toBeVisible();
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Selected Person/ })
  ).toHaveAttribute('aria-checked', 'true');
  await input.fill('slt');
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Selected Person/ })
  ).toHaveAttribute('aria-checked', 'true');
  await input.fill('rare');
  await expect(
    page.getByRole('menuitemcheckbox', { name: /Rare Person/ })
  ).toBeVisible();
  await expect(page.getByTestId('selected-emails')).toContainText(
    'selected@example.com'
  );
  await page.getByRole('menuitemcheckbox', { name: /Rare Person/ }).click();
  await expect(page.getByTestId('selected-emails')).toContainText(
    'rare@example.com'
  );
  await filter.click();
  await page.getByRole('menuitem', { name: 'Organizer', exact: true }).click();
  await input.fill('new@example.com');
  await page
    .getByRole('menuitem', { name: 'Add new@example.com', exact: true })
    .click();
  await expect(page.getByTestId('selected-emails')).toContainText(
    'new@example.com'
  );
  await expect(page.getByTestId('selected-emails')).toContainText(
    'external@example.com'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
