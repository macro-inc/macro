import { expect, test } from '@playwright/test';

const channelUrl =
  'https://dev.macro.com/app/channel/0195ceb6-ec2e-7023-80e4-6e084fa6cccd';
const markdown = '# heading\n- item **bold**';

test('pastes Macro links and Markdown into a code block verbatim', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    )
      await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/src/features/channel/Input/browser-test/draft.html');
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await editor.click();
  await page.keyboard.type('``` ');
  const code = editor.locator('code');
  await expect(code).toHaveCount(1);

  const paste = (text: string) =>
    editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData,
          bubbles: true,
          cancelable: true,
        })
      );
    }, text);

  // Outside code this link becomes a mention, which the code block dropped.
  await paste(channelUrl);
  await expect(code).toHaveText(channelUrl);
  // Parsing this as Markdown stripped the heading, list, and bold syntax.
  await paste(`\n${markdown}`);
  await expect.poll(() => code.innerText()).toBe(`${channelUrl}\n${markdown}`);

  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  // The trailing paragraph after the code block sends as blank lines.
  await expect
    .poll(async () =>
      (await page.getByLabel('Sent message').textContent())?.trimEnd()
    )
    .toBe(`\`\`\`plaintext\n${channelUrl}\n${markdown}\n\`\`\``);
  expect(errors).toEqual([]);
});
