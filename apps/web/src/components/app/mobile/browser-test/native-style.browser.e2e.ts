import { expect, test } from '@playwright/test';

for (const platform of ['web', 'android', 'ios']) {
  for (const theme of ['light', 'dark']) {
    test(`${platform} ${theme} loads only its material and preserves press paint`, async ({
      page,
    }) => {
      const assets: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('glassPress.css'))
          assets.push(request.url());
      });
      await page.goto(`/native-style.html?platform=${platform}&theme=${theme}`);
      const wide = page.getByRole('button', { name: 'Press surfaces' });
      await expect(wide).toBeVisible();
      expect(assets.length > 0).toBe(platform === 'ios');
      const content = await wide.evaluate(
        (element) => getComputedStyle(element, '::before').content
      );
      expect(content === '""').toBe(platform === 'ios');
      await wide.dispatchEvent('pointerdown', {
        button: 0,
        isPrimary: true,
        pointerId: 1,
      });
      await expect(wide).toHaveAttribute('data-glass-press', 'wide');
      if (platform === 'ios') {
        await wide.evaluate(async (element) => {
          await new Promise(requestAnimationFrame);
          await Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished)
          );
        });
        expect(
          await wide.evaluate((element) =>
            getComputedStyle(element, '::before').getPropertyValue(
              '--press-light'
            )
          )
        ).toBe('1');
        expect(
          await wide.evaluate(
            (element) => getComputedStyle(element, '::before').backgroundImage
          )
        ).toContain('radial-gradient');
      }
      await wide.dispatchEvent('pointerup', {
        button: 0,
        isPrimary: true,
        pointerId: 1,
      });
      await expect(wide).not.toHaveAttribute('data-glass-press');
      await expect(
        page.getByRole('button', { name: 'Unavailable' })
      ).toBeDisabled();
    });
  }
}
