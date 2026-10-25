import { type Browser, expect } from '@playwright/test';

/** Check handoffs, not just the middle of a drag: both use the same geometry. */
export async function verifyCrmMotion(browser: Browser, origin: string) {
  for (const width of [393, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 852 },
      isMobile: width < 800,
      hasTouch: width < 800,
      reducedMotion: 'no-preference',
    });
    try {
      await page.goto(`${origin}/?theme=cream`);
      await page.locator('#crm').scrollIntoViewIfNeeded();
      await page.locator('.homepage-crm-viewport').waitFor();
      const card = page.locator(
        '[data-crm-company="northwind"] .homepage-crm-card-surface'
      );
      const beforeHover = await card.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.boxShadow];
      });
      const cardBounds = await card.boundingBox();
      if (!cardBounds) throw new Error('CRM card has no bounds');
      await page.mouse.move(
        cardBounds.x + cardBounds.width / 2,
        cardBounds.y + cardBounds.height / 2
      );
      expect(
        await card.evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.backgroundColor, style.boxShadow];
        })
      ).toEqual(beforeHover);

      const handoffs = await page.evaluate(
        () =>
          new Promise<{ before: number[]; after: number[] }[]>(
            (resolve, reject) => {
              const changes: { before: number[]; after: number[] }[] = [];
              let previous: number[] | undefined;
              let previousPhase: string | undefined;
              const start = performance.now();
              const sample = () => {
                const source = document.querySelector(
                  '[data-crm-company="northwind"]'
                );
                const drag = document.querySelector('.homepage-crm-drag');
                if (!source) {
                  reject(new Error('CRM source card is missing'));
                  return;
                }
                const active = drag?.textContent?.includes('Keystone')
                  ? drag
                  : source;
                const phase =
                  active === source
                    ? source.getAttribute('data-crm-stage')
                    : 'drag';
                const bounds = active.getBoundingClientRect();
                const current = [
                  bounds.x,
                  bounds.y,
                  bounds.width,
                  bounds.height,
                ];
                if (previous && previousPhase && phase !== previousPhase)
                  changes.push({ before: previous, after: current });
                if (phase === 'Proposal') {
                  resolve(changes);
                  return;
                }
                if (performance.now() - start > 14000) {
                  reject(new Error('CRM pickup/drop did not complete'));
                  return;
                }
                previous = current;
                previousPhase = phase ?? undefined;
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }
          )
      );
      expect(handoffs).toHaveLength(2);
      for (const handoff of handoffs)
        for (let axis = 0; axis < 4; axis++)
          expect(
            Math.abs(handoff.before[axis] - handoff.after[axis])
          ).toBeLessThan(1);
      await expect(page.locator('.homepage-crm-cursor')).toHaveCSS(
        'transition-duration',
        '0s'
      );
      await expect(
        page.locator('.homepage-crm-card-surface').first()
      ).toHaveCSS('pointer-events', 'none');
      console.log(
        `[prerender] CRM ${width}px: pickup/drop preserve bounds and animation has no hover/cursor easing`
      );
    } finally {
      await page.close();
    }
  }
}
