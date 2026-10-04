import { expect, test } from '@playwright/test';

test('long property values stay within their columns', async ({ page }) => {
  await page.goto('/src/features/tasks-view/browser-test/property-layout.html');
  const cells = page.getByTestId('property-cell');
  await expect(cells).toHaveCount(2);
  for (const cell of await cells.all()) {
    const bounds = await cell.evaluate((element) => {
      const column = element.getBoundingClientRect();
      const root = element.querySelector('.property-root')!;
      const trigger = root.querySelector('[role="link"]')!;
      const value = root.querySelector('.list-property-cell')!;
      return {
        column: { left: column.left, right: column.right },
        children: [root, trigger, value].map((child) => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      };
    });
    for (const child of bounds.children) {
      expect(child.left).toBeGreaterThanOrEqual(bounds.column.left - 1);
      expect(child.right).toBeLessThanOrEqual(bounds.column.right + 1);
    }
  }
});
