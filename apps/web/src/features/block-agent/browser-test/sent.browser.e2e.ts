import { expect, test } from '@playwright/test';

// A session composer whose parent owns the draft, as every session block does.
// Enter right after fast typing used to leave the sent text in the box: the
// input cleared the draft, but the editor kept its old content.
test('Enter empties the composer once the message is sent', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Enter adds a line on touch screens; Send sends there');
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 404, json: [] })
  );
  await page.goto('/sent.html');
  const composer = page.getByRole('textbox').last();
  await composer.click();

  for (const message of ['The first prompt.', 'A follow-up prompt.']) {
    await page.keyboard.type(message, { delay: 5 });
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('sent').getByText(message)).toBeVisible();
    await expect(composer).toHaveText('');
  }
});
