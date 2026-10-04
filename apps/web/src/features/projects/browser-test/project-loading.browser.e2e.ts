import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  for (const section of ['overview', 'tasks']) {
    test(`${section} loading fits ${mobile ? 'mobile' : 'desktop'}`, async ({
      page,
    }) => {
      const params = new URLSearchParams();
      if (mobile) params.set('mobile', '1');
      if (section === 'tasks') params.set('tasks', '1');
      await page.goto(
        `/src/features/projects/browser-test/project-loading.html?${params}`
      );
      await expect(
        page.getByRole('status', { name: 'Loading project', exact: true })
      ).toBeVisible();
      const layout = await page.locator('main').evaluate((element) => {
        const container = element.getBoundingClientRect();
        return {
          container: { left: container.left, right: container.right },
          bars: [...element.querySelectorAll('.skeleton-shimmer')]
            .filter((bar) => bar.getBoundingClientRect().width > 0)
            .map((bar) => {
              const rect = bar.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top };
            }),
        };
      });
      expect(layout.bars.length).toBeGreaterThan(8);
      for (const bar of layout.bars) {
        expect(bar.left).toBeGreaterThanOrEqual(layout.container.left);
        expect(bar.right).toBeLessThanOrEqual(layout.container.right);
      }
      if (section === 'overview') {
        expect(layout.bars[0].top).toBeCloseTo(mobile ? 24 : 48, 0);
        if (mobile)
          expect(layout.bars[4].top).toBeGreaterThan(layout.bars[1].top);
      }
    });
  }
}
