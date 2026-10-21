import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { verifyDemo } from './verifyDemo';
import { verifyProductPages } from './verifyProductPages';

/** Verify the prerendered homepage keeps its first paint while becoming interactive. */
export async function verifyHomepage(directory: string): Promise<void> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      let filename = path.resolve(
        directory,
        `.${pathname === '/' ? '/index.html' : pathname}`
      );
      if (!filename.startsWith(`${directory}/`))
        return new Response(null, { status: 404 });
      if (!path.extname(filename)) filename = path.join(filename, 'index.html');
      const file = Bun.file(filename);
      return (await file.exists())
        ? new Response(file)
        : new Response(null, { status: 404 });
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const origin = `http://127.0.0.1:${server.port}`;
    await verifyDemo(browser, origin);
    // Light mode renders the cream palette (src/features/setup/sitePalette.ts).
    for (const [viewport, colorScheme] of [
      [{ width: 1440, height: 1000 }, 'dark'],
      [{ width: 390, height: 844 }, 'light'],
    ] as const) {
      const label = `${viewport.width}×${viewport.height} ${colorScheme}`;
      const page = await browser.newPage({
        viewport,
        colorScheme,
        isMobile: viewport.width < 768,
        hasTouch: viewport.width < 768,
        reducedMotion: 'reduce',
      });
      let releaseScripts!: () => void;
      const scriptsReady = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      // Hold JS until the server-rendered page has painted. This makes identity
      // and layout comparisons deterministic even on a fast build machine.
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          await route.abort();
          return;
        }
        if (route.request().resourceType() === 'script') await scriptsReady;
        await route.continue();
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (/hydration mismatch/i.test(message.text()))
          errors.push(message.text());
      });
      try {
        await page.goto(origin, { waitUntil: 'commit' });
        const headingLocator = page.locator('[data-welcome-heading]');
        await headingLocator.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        const heading = await headingLocator.elementHandle();
        if (!heading) throw new Error(`Homepage has no SSR heading (${label})`);
        const before = await heading.boundingBox();
        const initialText = await heading.textContent();
        const rootHeight = await page
          .locator('#root')
          .evaluate((element) => element.getBoundingClientRect().height);
        if (Math.abs(rootHeight - viewport.height) > 1)
          throw new Error(
            `Homepage SSR root height is ${rootHeight}, expected viewport height ${viewport.height} (${label})`
          );

        // The SSR fallback is desktop, but CSS must hide it on phones before
        // hydration replaces it with the mobile story. Otherwise it flashes in.
        const desktopDemo = page.locator('.homepage-embedded-demo');
        if (viewport.width < 800) await expect(desktopDemo).toBeHidden();
        else await expect(desktopDemo).toBeVisible();

        releaseScripts();
        await page.waitForLoadState('load');
        if (errors.length)
          throw new Error(
            `Homepage hydration failed (${label}): ${errors.join('; ')}`
          );
        await page.waitForSelector(
          '#root[data-public-ready="true"] .homepage-feature',
          {
            state: 'attached',
            timeout: 10000,
          }
        );
        if (viewport.width < 800) {
          await expect(desktopDemo).toHaveCount(0);
          await expect(page.locator('.homepage-mobile-story')).toBeVisible();
          const featureGap = await page
            .locator('#coding-agents .homepage-feature-title')
            .evaluate((heading) => {
              const links = document.querySelector(
                '#documents .homepage-feature-more-group'
              );
              if (!links) throw new Error('Missing document feature links');
              return (
                heading.getBoundingClientRect().top -
                links.getBoundingClientRect().bottom
              );
            });
          expect(featureGap).toBeGreaterThanOrEqual(64);
        } else await expect(desktopDemo).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        if (!(await heading.evaluate((element) => element.isConnected)))
          throw new Error(
            `Homepage replaced its first-painted heading during hydration (${label})`
          );
        if ((await heading.textContent()) !== initialText)
          throw new Error(
            `Homepage changed heading text during hydration (${label})`
          );
        const after = await heading.boundingBox();
        if (
          !before ||
          !after ||
          (['x', 'y', 'width', 'height'] as const).some(
            (key) => Math.abs(before[key] - after[key]) > 1
          )
        )
          throw new Error(
            `Homepage heading moved during hydration (${label}): ${JSON.stringify({ before, after })}`
          );
        await heading.dispose();

        if (viewport.width >= 768)
          await page
            .getByRole('link', { name: 'Macro home', exact: true })
            .hover();
        else
          await page
            .getByRole('button', { name: 'Open navigation', exact: true })
            .tap();
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .waitFor({ state: 'visible' });
        if (viewport.width >= 768) await page.keyboard.press('Escape');
        else
          await page
            .getByRole('button', { name: 'Close navigation', exact: true })
            .tap();
        if (viewport.width >= 800) {
          await page.locator('#interactive-demo').scrollIntoViewIfNeeded();
          await page
            .getByRole('button', {
              name: /^Interact with Macro sample workspace/,
            })
            .click();
          const workspace = page.frameLocator(
            'iframe[title="Embedded Macro sample workspace"]'
          );
          const chat = workspace
            .getByRole('navigation', { name: 'Workspace navigation' })
            .getByRole('button', { name: 'Chat', exact: true });
          await chat.click();
          await expect(chat).toHaveAttribute('aria-current', 'page');
          await expect(
            workspace.getByRole('complementary', { name: 'Chat navigation' })
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Show Docs highlight', exact: true })
            .click();
          await expect(
            workspace
              .getByRole('navigation', { name: 'Workspace navigation' })
              .getByRole('button', { name: 'Drive', exact: true })
          ).toHaveAttribute('aria-current', 'page');
        }
        await page.locator('#email').scrollIntoViewIfNeeded();
        await page
          .locator('[data-email-demo-body]')
          .waitFor({ state: 'visible' });
        const entry = page.getByRole('button', {
          name: /^Interact with Email and chat/,
        });
        if (viewport.width < 768) await entry.tap();
        else await entry.click();
        await expect(
          page.getByRole('textbox', { name: 'Email body', exact: true })
        ).toBeEditable();
        if (errors.length)
          throw new Error(
            `Homepage demo failed (${label}): ${errors.join('; ')}`
          );
        console.log(
          `[prerender] Homepage ${label}: SSR heading identity and layout, hydration, navigation, sample workspace, and email demo verified`
        );
      } finally {
        releaseScripts();
        await page.close();
      }
    }
    await verifyProductPages(browser, origin);
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
