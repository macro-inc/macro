import { expect, type Page, test } from '@playwright/test';

// Wait for the browser's observer delivery after layout, rather than a timer.
async function afterLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

test('overscanned replies stay unread until scrolled into the channel viewport', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const reply = page.locator('[data-message="23"]');
  await expect(reply).toBeAttached();
  await page.getByRole('button', { name: 'Notify offscreen reply' }).click();
  await afterLayout(page);
  await page.screenshot({ path: testInfo.outputPath('offscreen.png') });
  await expect(page.locator('[data-notification="23"]')).toHaveText('Unread');
  await reply.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.locator('[data-notification="23"]')).toHaveText('Read');
  await page.screenshot({ path: testInfo.outputPath('visible.png') });
});

test('composer-covered replies and hidden panes do not clear notifications', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-message="29"]')).toBeAttached();
  // Put the last reply entirely behind the composer while keeping it mounted.
  await page.locator('[data-channel-scroll]').evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 96;
  });
  await afterLayout(page);
  await page.getByRole('button', { name: 'Notify covered reply' }).click();
  await afterLayout(page);
  await expect(page.locator('[data-notification="29"]')).toHaveText('Unread');
  await page.getByRole('button', { name: 'Toggle pane' }).click();
  await page.getByRole('button', { name: 'Remove overlays' }).click();
  await afterLayout(page);
  await expect(page.locator('[data-notification="29"]')).toHaveText('Unread');
  await page.getByRole('button', { name: 'Toggle pane' }).click();
  await page
    .locator('[data-message="29"]')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.locator('[data-notification="29"]')).toHaveText('Read');
});

test('standalone expanded threads keep offscreen replies unread', async ({
  page,
}) => {
  await page.goto('/?mode=panel');
  await page.getByRole('button', { name: 'Notify offscreen reply' }).click();
  await afterLayout(page);
  await expect(page.locator('[data-notification="0"]')).toHaveText('Unread');
  await page
    .locator('[data-message="0"]')
    .evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.locator('[data-notification="0"]')).toHaveText('Read');
});

test('a reply scrolled out from behind the composer becomes read', async ({
  page,
}) => {
  await page.goto('/');
  const scroller = page.locator('[data-channel-scroll]');
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - 96;
  });
  await afterLayout(page);
  await page.getByRole('button', { name: 'Notify covered reply' }).click();
  await afterLayout(page);
  await expect(page.locator('[data-notification="29"]')).toHaveText('Unread');
  await scroller.evaluate((el) => {
    el.scrollTop += 96;
  });
  await expect(page.locator('[data-notification="29"]')).toHaveText('Read');
});

test('a notification arriving in the same task as a scroll waits for fresh visibility', async ({
  page,
}) => {
  await page.goto('/');
  const reply = page.locator('[data-message="23"]');
  await reply.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.getByRole('button', { name: 'Notify offscreen reply' }).click();
  await expect(page.locator('[data-notification="23"]')).toHaveText('Read');
  await page.getByRole('button', { name: 'Scroll away and notify' }).click();
  await afterLayout(page);
  await expect(page.locator('[data-notification="23"]').last()).toHaveText(
    'Unread'
  );
  await reply.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(page.locator('[data-notification="23"]').last()).toHaveText(
    'Read'
  );
});
