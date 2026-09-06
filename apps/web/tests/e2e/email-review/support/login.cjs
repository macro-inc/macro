const { chromium, expect } = require(
  process.cwd() + '/node_modules/@playwright/test'
);
const fs = require('node:fs');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
const origin = process.env.EMAIL_REVIEW_ORIGIN || 'http://localhost:24710';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Local seed only');
fs.mkdirSync(output + '/artifacts', { recursive: true });
(async () => {
  const b = await chromium.connectOverCDP(
    process.env.EMAIL_REVIEW_CDP || 'http://localhost:9222'
  );
  try {
    for (const user of ['alex', 'guest', 'maya']) {
      const context = await b.newContext({
          viewport: { width: 1440, height: 900 },
        }),
        page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (e) =>
        console.log(user, 'initial login error:', e.message)
      );
      await page.goto(
        `${origin}/app/login?email=${user}.email-review@seed.macro.local`
      );
      await page.waitForTimeout(3000);
      if (page.url().includes('/login') || page.url().includes('/welcome')) {
        const input = page.getByPlaceholder('you@company.com');
        if (await input.count())
          await input.fill(`${user}.email-review@seed.macro.local`);
        const button = page.getByRole('button', {
          name: 'Continue',
          exact: true,
        });
        if (await button.count()) await button.click();
      }
      await context.storageState({ path: `${output}/${user}-auth.json` });
      if (
        await page
          .getByText('Something went terribly wrong', { exact: true })
          .count()
      ) {
        await page.screenshot({
          path: `${output}/artifacts/${user}-initial-login.png`,
        });
        console.log(user, 'recovering initial landing error');
        await page.goto(origin + '/app/component/mail');
      }
      await expect(
        page.getByRole('button', { name: 'Go to Email', exact: true })
      ).toBeVisible({ timeout: 60000 });
      await context.storageState({ path: `${output}/${user}-auth.json` });
      fs.chmodSync(`${output}/${user}-auth.json`, 0o600);
      await context.close();
      console.log(user, 'authenticated');
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
