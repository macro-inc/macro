import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = process.env.PR_COMMENTS_SCREENSHOT_DIR;

test('CodeRabbit comments render GitHub markdown, not raw HTML', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/src/features/block-pr/browser-test/github-comments.html');

  const review = page.getByTestId('comment-2');
  await expect(review.getByText('Actionable comments posted: 1')).toBeVisible({
    timeout: 60_000,
  });

  // No HTML or marker comments leak into the text.
  const text = (await page.locator('main').innerText()) ?? '';
  expect(text).not.toMatch(
    /<\/?(?:details|summary|dl|dd|picture|img|h6|strong|code)\b|<!--|coderabbit-ai-generated/
  );

  // Sections start collapsed behind their summary and open on press.
  const summary = review.locator('summary', {
    hasText: 'Prompt to fix all issues',
  });
  await expect(summary).toBeVisible();
  const prompt = review.getByText('Keep the cached rows visible');
  await expect(prompt).toBeHidden();
  await summary.click();
  await expect(prompt).toBeVisible();

  // Nested sections open one level at a time.
  await review.locator('summary', { hasText: 'Review info' }).click();
  const nested = review.locator('summary', { hasText: 'Run configuration' });
  await expect(nested).toBeVisible();
  await nested.click();
  await expect(
    review.getByRole('link', { name: 'example/repo' })
  ).toBeVisible();

  // Icons are dropped, bold labels keep their weight, code stays code.
  const walkthrough = page.getByTestId('comment-1');
  const risk = walkthrough.locator('summary', { hasText: 'Merge Risk:' });
  await expect(risk).toContainText('Merge Risk: Low · up to b215c');
  await expect(risk.getByText('b215c', { exact: true })).toHaveCSS(
    'font-family',
    /mono/i
  );
  await expect(
    walkthrough.getByRole('cell', { name: 'Warning' })
  ).toBeVisible();
  const inline = page.getByTestId('comment-3');
  await expect(inline.getByText('Minor', { exact: true })).toHaveCSS(
    'font-weight',
    /^(600|700|bold)$/
  );

  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/coderabbit-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
