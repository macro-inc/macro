import { type Browser, expect } from '@playwright/test';

/** The sample workspace must be styled even before its application JS loads. */
export async function verifyDemo(
  browser: Browser,
  origin: string
): Promise<void> {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    for (const theme of ['dark', 'cream'] as const) {
      const label = `${viewport.width}×${viewport.height} ${theme}`;
      const page = await browser.newPage({
        viewport,
        colorScheme: theme === 'cream' ? 'light' : 'dark',
        isMobile: viewport.width < 768,
        reducedMotion: 'reduce',
      });
      try {
        // Leave the small inline palette bootstrap enabled, but never load the
        // client bundle: it would replace the SSR styles and hide this bug.
        await page.route('**/*', async (route) => {
          if (
            new URL(route.request().url()).origin !== origin ||
            route.request().resourceType() === 'script'
          ) {
            await route.abort();
            return;
          }
          await route.continue();
        });
        await page.goto(`${origin}/demo?theme=${theme}`, {
          waitUntil: 'load',
        });
        const workspace = page.locator('.dummy-workspace');
        await expect(
          workspace,
          `Workspace background matches the palette before JS (${label})`
        ).toHaveCSS(
          'background-color',
          theme === 'cream' ? 'rgb(245, 241, 232)' : 'oklch(0.17 0 0)'
        );
        await expect(workspace).toHaveCSS(
          'color',
          theme === 'cream' ? 'oklch(0.2 0.004 70)' : 'oklch(1 0 21)'
        );
        await expect(
          page.getByRole('heading', {
            name: 'What should we work on?',
            exact: true,
          })
        ).toHaveCSS(
          'color',
          theme === 'cream' ? 'rgb(0, 0, 0)' : 'oklch(1 0 21)'
        );
        const rail = page.locator('[data-ui="sidebar-rail"]');
        await expect(
          rail,
          `Workspace rail is styled before JS (${label})`
        ).toHaveCSS('display', 'flex');
        await expect(rail).toHaveCSS('flex-direction', 'column');
        const home = rail.getByRole('button', { name: 'Home', exact: true });
        await expect(home).toHaveCSS('display', 'flex');
        await expect(home).toHaveCSS(
          'width',
          viewport.width < 650 ? '36px' : '40px'
        );
        await expect(home).toHaveCSS('height', '40px');
        await expect(
          rail
            .getByRole('button', { name: 'Create in workspace', exact: true })
            .locator('svg')
        ).toHaveCSS('width', '20px');
        const avatar = rail.getByRole('img', { name: 'Jacob', exact: true });
        await expect(avatar).toHaveCSS('width', '32px');
        await expect(avatar).toHaveCSS('height', '32px');
        const avatarRadius = await avatar.evaluate((element) =>
          parseFloat(getComputedStyle(element).borderTopLeftRadius)
        );
        expect(avatarRadius).toBeGreaterThanOrEqual(16);
        await expect(page.locator('.dummy-sidebar')).toHaveCSS(
          'display',
          viewport.width < 650 ? 'none' : 'block'
        );
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        );
        expect(
          overflow,
          `Workspace does not overflow horizontally (${label})`
        ).toBe(false);
        console.log(
          `[prerender] Sample workspace ${label}: palette, navigation, controls, icons, avatars, and responsive layout styled before JS`
        );
      } finally {
        await page.close();
      }
    }
  }
}
