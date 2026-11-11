import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks();
test('real Source link copy replaces a trusted clipboard sentinel', async ({
  page,
  hasTouch,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/link');
  await expect(
    page.locator('.menu-surface').getByText('Link', { exact: true })
  ).toBeVisible();
  await expect(
    page.locator('.menu-surface').getByText('Normal Text', { exact: true })
  ).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page
    .getByPlaceholder('https://example.com', { exact: true })
    .fill('https://example.com/original');
  await page
    .getByPlaceholder('Link text', { exact: true })
    .fill('Fixture link');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const link = body.getByRole('link', { name: 'Fixture link', exact: true });
  await expect(link).toBeVisible();
  await page.evaluate(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'clipboard-receiver';
    document.body.append(textarea);
  });
  const receiver = page.locator('#clipboard-receiver');
  await receiver.fill('before link copy');
  await receiver.press('ControlOrMeta+a');
  await receiver.press('ControlOrMeta+c');
  await receiver.fill('');
  await receiver.press('ControlOrMeta+v');
  await expect(receiver).toHaveValue('before link copy');
  if (hasTouch) await link.tap();
  else await link.click();
  // A touch action can return before the actual browser clipboard write ends.
  // Observe its real completion without supplying data or a clipboard provider.
  const completion = page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const write = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async (text) => {
          try {
            await write.call(navigator.clipboard, text);
            resolve();
          } catch (error) {
            reject(error);
            throw error;
          } finally {
            navigator.clipboard.writeText = write;
          }
        };
      })
  );
  const copy = page.locator('.menu-surface button').nth(2);
  if (hasTouch) await copy.tap();
  else await copy.click();
  await completion;
  await receiver.fill('');
  await receiver.press('ControlOrMeta+v');
  await expect(receiver).toHaveValue('https://example.com/original');
  await page.keyboard.press('Escape');
});
