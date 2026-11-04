import { expect, test } from '@playwright/test';

test('an agent m-document routine mention is clickable', async ({ page }) => {
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/routine-mention.html'
  );
  const mention = page.getByRole('link', { name: 'Daily review' });
  await expect(mention).toBeVisible();
  await expect(mention.locator('[data-block-name="routine"]')).toHaveAttribute(
    'data-document-id',
    '0195ceb6-ec2e-7023-80e4-6e084fa6cccd'
  );
  await mention.click();
  await expect(page.getByLabel('Opened split')).toContainText(
    '"type":"routine"'
  );
  await expect(page.getByLabel('Opened split')).toContainText(
    '"id":"0195ceb6-ec2e-7023-80e4-6e084fa6cccd"'
  );

  const collapsed = page.getByRole('link', { name: 'Collapsed review' });
  await expect(collapsed).toBeVisible();
  await expect(collapsed.locator('[data-block-name="routine"]')).toBeHidden();
  await collapsed.hover();
  await expect(page.getByText('Collapsed review')).toBeVisible();
});
