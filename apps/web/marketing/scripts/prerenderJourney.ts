import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

/** Snapshot the actual public UI, not a second crawler-only version of it.
 * The editors remain client enhancements; headings, copy and links ship in HTML.
 */
export async function prerenderJourney(directory: string): Promise<string> {
  const template = readFileSync(path.join(directory, 'index.html'), 'utf8');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const filename = path.resolve(
        directory,
        `.${pathname === '/' ? '/index.html' : pathname}`
      );
      if (!filename.startsWith(`${directory}/`))
        return new Response(null, { status: 404 });
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
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    // Builds must never contact analytics, auth, or third-party services.
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort()
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForSelector(
      '#root[data-public-ready="true"] .homepage-feature',
      { state: 'attached' }
    );
    await page.evaluate(() => document.fonts.ready);
    if (errors.length)
      throw new Error(`Homepage failed to render: ${errors.join('; ')}`);
    const snapshot = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const copy = root.cloneNode(true) as HTMLElement;
      copy.removeAttribute('data-public-ready');
      copy.setAttribute('data-prerendered', '');
      copy
        .querySelectorAll('[data-reveal]')
        .forEach((node) => node.removeAttribute('data-reveal'));
      copy
        .querySelectorAll('[data-motion]')
        .forEach((node) => node.removeAttribute('data-motion'));
      copy
        .querySelectorAll(
          '.unification-travel, .homepage-open-source-travel, script'
        )
        .forEach((node) => node.remove());
      const html = document.documentElement.cloneNode(false) as HTMLElement;
      const themeStyle = html.getAttribute('style') ?? '';
      // Large inline theme attributes push charset past the browser's first
      // 1024 bytes. Keep the same first-paint tokens in the head instead.
      html.removeAttribute('style');
      return {
        root: copy.outerHTML,
        htmlTag: html.outerHTML.replace('</html>', ''),
        themeStyle,
      };
    });
    if (
      !snapshot.root.includes('One unified interface') ||
      !snapshot.root.includes('href="/agents"')
    ) {
      throw new Error(
        'Homepage snapshot is missing its headline or crawlable navigation'
      );
    }
    return template
      .replace(/<div id="root"[^>]*><\/div>/, () => snapshot.root)
      .replace(/<html\b[^>]*>/, () => snapshot.htmlTag)
      .replace(
        '</head>',
        `<style>:root{${snapshot.themeStyle}}[data-prerendered] .obf-card,[data-prerendered] .ob-orbit-tile{animation:none!important}</style></head>`
      );
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
