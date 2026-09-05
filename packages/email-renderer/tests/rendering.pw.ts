import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from '../viewer/main';

for (const file of readdirSync(new URL('./fixtures', import.meta.url)).filter(
  (file) => file.endsWith('.json')
)) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
  ) as { name: string; container_widths?: number[] };
  for (const theme of ['light', 'dark']) {
    for (const width of fixture.container_widths ?? [600]) {
      test(`${fixture.name} ${theme} ${width}`, async ({ page }) => {
        const errors: string[] = [];
        const remote: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
          if (!request.url().startsWith('http://127.0.0.1:24821'))
            remote.push(request.url());
        });
        await page.goto(
          `/?fixture=${fixture.name}&theme=${theme}&width=${width}`
        );
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('#email-host')).toHaveScreenshot(
          `${fixture.name}-${theme}-${width}.png`
        );
        expect(errors).toEqual([]);
        expect(remote).toEqual([]);
      });
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('blocked resource policy prevents real requests from escaped CSS URL functions', async ({
  page,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('renderer.invalid')) remote.push(request.url());
  });
  await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    document.body.append(host);
    const body = prepareEmailBody(
      {
        html: '<style>p{background:u\\72l("https://renderer.invalid/style")}</style><p style="background:u\\72l(\'https://renderer.invalid/inline\')">Text</p>',
      },
      { images: { remote: 'block' } }
    );
    const renderer = mountEmailBody(host, body, {
      theme: themes.light,
      adaptColors: false,
      normalizeFonts: false,
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    renderer.dispose();
  });
  expect(remote).toEqual([]);
});

test('shadow isolation, link safety, literal plaintext and quote expansion use production preparation', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    document.body.append(host);
    const options = {
      theme: themes.light,
      adaptColors: false,
      normalizeFonts: false,
    };
    const input = {
      html: '<style>body{color:red}</style><p>Hello <a href="https://example.com">Link</a></p><div class="macro_quote">Quoted</div>',
    };
    const prepared = prepareEmailBody(input);
    const renderer = mountEmailBody(host, prepared, options);
    const shortText = host.shadowRoot!.textContent;
    const link = host.shadowRoot!.querySelector('a')!;
    const linkPolicy = { target: link.target, rel: link.rel };
    renderer.update(
      prepareEmailBody(input, { showQuotedContent: true }),
      options
    );
    const fullText = host.shadowRoot!.textContent;
    renderer.update(
      prepareEmailBody({ text: '<b>Literal</b>\n**Markdown**' }),
      options
    );
    const plain = host.shadowRoot!.querySelector('div')!.textContent;
    const outerColor = getComputedStyle(document.body).color;
    renderer.dispose();
    renderer.dispose();
    return {
      shortText,
      fullText,
      linkPolicy,
      plain,
      outerColor,
      remaining: host.shadowRoot!.childNodes.length,
    };
  });
  expect(result.shortText).not.toContain('Quoted');
  expect(result.fullText).toContain('Quoted');
  expect(result.linkPolicy).toEqual({
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  expect(result.plain).toBe('<b>Literal</b>\n**Markdown**');
  expect(result.outerColor).not.toBe('rgb(255, 0, 0)');
  expect(result.remaining).toBe(0);
});

test('resizes wide content, removes stale scaling, hides collapsed images', async ({
  page,
}) => {
  await page.evaluate(() => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    host.id = 'resize-host';
    host.style.width = '360px';
    document.body.append(host);
    const renderer = mountEmailBody(
      host,
      prepareEmailBody({
        html: '<table width="1000"><tr><td>Wide</td></tr></table><img src="cid:a">',
      }),
      { theme: themes.light, adaptColors: false, normalizeFonts: false }
    );
    host.addEventListener('collapse', () => renderer.setExpanded(false));
  });
  const content = page.locator('#resize-host > div');
  await expect(content).toHaveCSS('zoom', '0.7');
  await expect(content).toHaveCSS('overflow-x', 'auto');
  await page.locator('#resize-host').evaluate((host) => {
    (host as HTMLElement).style.width = '1200px';
  });
  await expect(content).toHaveCSS('zoom', '1');
  await expect(content).toHaveCSS('overflow-x', 'visible');
  await page.locator('#resize-host').dispatchEvent('collapse');
  await expect(page.locator('#resize-host img')).toHaveCSS('display', 'none');
});

test('aborts replaced resources, releases late results, and handles rejected adapters', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    document.body.append(host);
    const signals: AbortSignal[] = [];
    const released: number[] = [];
    const errors: string[] = [];
    let finish = () => {};
    const options = {
      theme: themes.light,
      adaptColors: true,
      normalizeFonts: false,
    };
    const renderer = mountEmailBody(
      host,
      prepareEmailBody({ html: '<p>First</p>' }),
      {
        ...options,
        async resolveImages(_root, lifetime) {
          signals.push(lifetime.signal);
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          lifetime.onDispose(() => released.push(1));
        },
      }
    );
    await Promise.resolve();
    renderer.update(prepareEmailBody({ html: '<p>Second</p>' }), {
      ...options,
      async resolveImages(_root, lifetime) {
        signals.push(lifetime.signal);
        throw new Error('Image unavailable');
      },
      onResourceError(error) {
        errors.push(String(error));
      },
    });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const text = host.shadowRoot!.querySelector('div')!.textContent;
    renderer.dispose();
    return {
      aborted: signals.map((signal) => signal.aborted),
      released,
      errors,
      text,
    };
  });
  expect(result).toEqual({
    aborted: [true, true],
    released: [1],
    errors: ['Error: Image unavailable'],
    text: 'Second',
  });
});

test('theme updates start from prepared content rather than accumulating color transforms', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    document.body.append(host);
    const prepared = prepareEmailBody({
      html: '<p style="color:rgb(30,30,30);background-color:white">Text <a style="color:rgb(10,100,220)" href="https://example.com">Link</a></p>',
    });
    const frame = () => new Promise(requestAnimationFrame);
    const renderer = mountEmailBody(host, prepared, {
      theme: themes.light,
      adaptColors: true,
      normalizeFonts: false,
    });
    await frame();
    const light = host.shadowRoot!.querySelector('p')!.getAttribute('style');
    renderer.update(prepared, {
      theme: themes.dark,
      adaptColors: true,
      normalizeFonts: false,
    });
    await frame();
    const dark = host.shadowRoot!.querySelector('p')!.getAttribute('style');
    renderer.update(prepared, {
      theme: themes.light,
      adaptColors: true,
      normalizeFonts: false,
    });
    await frame();
    const lightAgain = host
      .shadowRoot!.querySelector('p')!
      .getAttribute('style');
    renderer.dispose();
    return { light, dark, lightAgain };
  });
  expect(result.dark).not.toEqual(result.light);
  expect(result.lightAgain).toEqual(result.light);
});

test('background adaptation preserves designed buttons and removes nested page backgrounds', async ({
  page,
}) => {
  const colors = await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = mountEmailBody(
      host,
      prepareEmailBody({
        html: '<div id="outer" style="background-color:white"><div id="inner" style="background-color:#f2f2f2">Text</div></div><div id="border" style="background-color:#51b1e7;padding:1px"><a id="face" style="background-color:#e4ecf2;color:#51b1e7">Button</a></div><a id="dark" style="background-color:#7e82c9;color:white">Button</a>',
      }),
      { theme: themes.dark, adaptColors: true, normalizeFonts: true }
    );
    await new Promise(requestAnimationFrame);
    const result = Object.fromEntries(
      ['outer', 'inner', 'border', 'face', 'dark'].map((id) => [
        id,
        (host.shadowRoot!.querySelector(`#${id}`) as HTMLElement).style
          .backgroundColor,
      ])
    );
    renderer.dispose();
    return result;
  });
  expect(colors).toEqual({
    outer: 'transparent',
    inner: 'transparent',
    border: 'rgb(81, 177, 231)',
    face: 'rgb(228, 236, 242)',
    dark: 'rgb(126, 130, 201)',
  });
});
