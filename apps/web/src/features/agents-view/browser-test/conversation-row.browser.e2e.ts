import { expect, test } from '@playwright/test';

test('timestamp overlay preserves title truncation on hover and keyboard focus', async ({
  page,
}) => {
  await page.goto(
    '/src/features/agents-view/browser-test/conversation-row.html'
  );
  for (const id of ['inactive', 'active']) {
    const row = page.locator(`[data-agent-session-row="${id}"]`);
    const title = row.locator('.truncate');
    const age = row.locator('.conversation-age');
    const width = await title.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    await expect(age).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(age).toHaveCSS('opacity', '1');
    expect(
      await title.evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(width);
    await page.getByRole('button', { name: 'Longer age' }).click();
    await row.hover();
    await expect(age).toHaveText('September 21');
    expect(
      await title.evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(width);
    await page.mouse.move(0, 0);
    await row
      .getByRole('button', {
        name: 'A long conversation title that truncates inside the sidebar',
      })
      .focus();
    await expect(age).toHaveCSS('opacity', '1');
    expect(
      await title.evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(width);
    const colors = await row.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      gradient: getComputedStyle(element.querySelector('.conversation-age')!)
        .backgroundImage,
    }));
    expect(colors.gradient).toContain(colors.background);
    await page.getByRole('button', { name: 'Longer age' }).focus();
    await expect(age).toHaveCSS('opacity', '0');
  }
});
