import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test.describe(mobile ? 'phone' : 'desktop', () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    test('project grouping follows assignment and clearing', async ({
      page,
    }) => {
      await page.routeWebSocket('**', (socket) => socket.close());
      await page.goto(
        '/src/features/tasks-view/browser-test/project-grouping.html'
      );
      const first = page.getByRole('region', {
        name: 'Project One',
        exact: true,
      });
      const second = page.getByRole('region', {
        name: 'Project Two',
        exact: true,
      });
      const unassigned = page.getByRole('region', {
        name: 'No Project',
        exact: true,
      });
      await expect(first.getByRole('button')).toContainText('Project One', {
        timeout: 30000,
      });
      if (mobile)
        expect(await page.evaluate(() => window.innerWidth)).toBe(390);
      await expect(second.getByRole('button')).toContainText('Project Two');
      await expect(unassigned).toContainText('Task Without Project');
      await expect(first).toContainText('Task One');
      await expect(second).toContainText('Task Two');
      await first.getByRole('button').click();
      await expect(
        first.getByRole('gridcell', { name: 'Task One', exact: true })
      ).toHaveCount(0);
      await first.getByRole('button').click();
      await page
        .getByRole('button', { name: 'Clear Task One project' })
        .click();
      await expect(first).toHaveCount(0);
      await expect(unassigned).toContainText('Task One');
      await page.getByRole('button', { name: 'Restore Project One' }).click();
      await expect(first).toContainText('Task One');
      await expect(unassigned).not.toContainText('Task One');

      // Headers that come back (a virtualized list remounts them on every
      // scroll) read the project name they already resolved: no request, no
      // Loading label.
      const counters = () =>
        page.evaluate(() => {
          const w = window as Window & {
            __identityRequests: number;
            __loadingFlips: number;
          };
          return { requests: w.__identityRequests, flips: w.__loadingFlips };
        });
      const before = await counters();
      await page.getByRole('button', { name: 'Remount headers' }).click();
      await expect(first.getByRole('button')).toContainText('Project One');
      await expect(second.getByRole('button')).toContainText('Project Two');
      const after = await counters();
      expect(after.flips).toBe(before.flips);
      // This client has no document cache, so a remount may refresh each
      // project once in the background; the normalized cache serves it.
      expect(after.requests).toBeLessThanOrEqual(before.requests + 2);
    });
  });
}
