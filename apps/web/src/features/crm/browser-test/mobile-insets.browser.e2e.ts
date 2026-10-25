import { expect, test } from '@playwright/test';

for (const device of [
  { name: 'phone', width: 390, height: 844, hasTouch: true },
  { name: 'tablet', width: 1024, height: 768, hasTouch: true },
  { name: 'desktop', width: 1280, height: 800, hasTouch: false },
]) {
  test.describe(device.name, () => {
    // A cold Vite server compiles the production shell's shared dependencies.
    test.setTimeout(180_000);
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.hasTouch,
    });
    test.beforeEach(async ({ page }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.route('https://**', (route) => route.abort());
      await page.route('**/__macro_dev/**', (route) => route.abort());
    });

    for (const surface of ['company', 'contact', 'crm', 'reviews', 'project']) {
      test(`${surface} clears navigation without double insets`, async ({
        page,
      }, testInfo) => {
        await page.goto(
          `/src/features/crm/browser-test/mobile-insets.html?surface=${surface}`,
          { waitUntil: 'domcontentloaded' }
        );
        if (surface === 'company' || surface === 'contact') {
          const heading = page.getByRole('heading');
          await expect(heading).toBeVisible({ timeout: 30000 });
          const box = await heading.boundingBox();
          expect(box?.y).toBe(device.hasTouch ? 116 : 48);
          await page.screenshot({
            path: testInfo.outputPath('overview-top.png'),
          });
          if (device.hasTouch) {
            await page
              .getByRole('button', { name: 'Files', exact: true })
              .click();
            const search = page.getByRole('searchbox', {
              name: 'Search files',
            });
            await expect(search).toBeVisible();
            const searchBox = await search.boundingBox();
            expect(searchBox!.y).toBeGreaterThanOrEqual(100);
            expect(searchBox!.y).toBeLessThan(112);
            await search.fill('proposal');
            await expect(page.getByText('Searching: proposal')).toBeVisible();
            await page
              .getByRole('button', { name: 'Overview', exact: true })
              .click();
            await expect(heading).toBeVisible({ timeout: 30000 });
          }
          const last = page.getByRole('button', { name: 'Last action' });
          await last.evaluate((element) => {
            const scroller = element.closest('.overflow-y-auto');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
          });
          await expect(last).toBeVisible();
          const lastBox = await last.boundingBox();
          expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(
            device.height - (device.hasTouch ? 128 : 48)
          );
        } else if (surface === 'project') {
          const button = page.getByRole('button', { name: 'Project tasks' });
          await expect(button).toBeVisible();
          const box = await button.boundingBox();
          expect(box!.y).toBeGreaterThanOrEqual(device.hasTouch ? 59 : 0);
          expect(box!.y).toBeLessThan(device.hasTouch ? 64 : 20);
          await button.click();
          await expect(page.getByText('Selected: tasks')).toBeVisible();
        } else {
          const button = page.getByRole('button', {
            name: 'People',
            exact: true,
          });
          await expect(button).toBeVisible({ timeout: 30000 });
          const box = await button.boundingBox();
          const top = device.hasTouch ? (surface === 'reviews' ? 100 : 55) : 16;
          expect(box!.y).toBeGreaterThanOrEqual(top);
          expect(box!.y).toBeLessThan(top + 5);
          await button.click();
          await expect(page.getByText('Selected: people')).toBeVisible();
          await page
            .getByRole('button', { name: 'Sales', exact: true })
            .click();
          await expect(
            page.getByText('Selected: pipeline:sales')
          ).toBeVisible();
        }
        await page.screenshot({
          path: testInfo.outputPath(`${surface}-${device.name}.png`),
        });
      });
    }
  });
}
