import { expect, type Page, test } from '@playwright/test';
import type {} from '../viewer/main';

const imagePixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);

/** Static-content checks share mounting; lifecycle tests below control their own renderer. */
async function mountHtml(
  page: Page,
  id: string,
  html: string,
  options: { theme?: 'light' | 'dark'; style?: Record<string, string> } = {}
) {
  await page.evaluate(
    ({ id, html, options }) => {
      const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
      const host = document.createElement('div');
      host.id = id;
      for (const [name, value] of Object.entries(options.style ?? {}))
        host.style.setProperty(name, value);
      document.body.append(host);
      mountEmailBody(host, prepareEmailBody({ html }), {
        theme: themes[options.theme ?? 'light'],
        adaptColors: false,
        normalizeFonts: false,
      });
    },
    { id, html, options }
  );
  return page.locator(`#${id}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('preserves CSS recovery and native variable cascade and fallbacks', async ({
  page,
}) => {
  const host = await mountHtml(
    page,
    'css-compat',
    '<style>.preheader{display:none;color:red !}.message{--tone:green;color:var(--tone,red);padding:var(--gap,5px);font-size:32px}.fallback{color:var(--missing,#dd1111);background:var(--image)}</style><div class="preheader">Hidden preview</div><div class="message"><p>Inherited green</p><p class="fallback">Fallback red</p></div><map name="offer"><area shape="rect" coords="0,0,20,20" href="//example.com/accept"></map><p>Image map footer</p>',
    { style: { '--gap': '9px' } }
  );
  await expect(host.locator('.preheader')).toBeHidden();
  await expect(host.locator('.message')).toHaveCSS('font-size', '32px');
  await expect(host.locator('.message')).toHaveCSS('padding', '9px');
  await expect(host.getByText('Inherited green')).toHaveCSS(
    'color',
    'rgb(0, 128, 0)'
  );
  await expect(host.locator('.fallback')).toHaveCSS(
    'color',
    'rgb(221, 17, 17)'
  );
  await expect(host.locator('.fallback')).toHaveCSS('background-image', 'none');
  await expect(host.locator('area')).toHaveAttribute(
    'href',
    'https://example.com/accept'
  );
  await expect(host.locator('area')).toHaveAttribute('target', '_blank');
  await expect(host.locator('area')).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  );
});

test('loads protocol-relative images and retains protocol-relative navigation', async ({
  page,
}) => {
  await page.route('https://renderer.invalid/image', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: imagePixel,
    })
  );
  const host = await mountHtml(
    page,
    'url-compat',
    '<img src="//renderer.invalid/image"><a href="//example.com/open">Open</a>'
  );
  await expect
    .poll(() =>
      host
        .locator('img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth)
    )
    .toBe(1);
  await expect(host.locator('a')).toHaveAttribute(
    'href',
    'https://example.com/open'
  );
});

test('preserves namespace, layer and scope styling in the browser', async ({
  page,
}) => {
  const host = await mountHtml(
    page,
    'grouped-css',
    '<style>@namespace h url(http://www.w3.org/1999/xhtml);@layer email{@scope (.group){h|p{color:red;font-size:32px}}}</style><div class="group"><p>Styled inside scope</p></div><p>Outside scope</p>'
  );
  await expect(host.getByText('Styled inside scope')).toHaveCSS(
    'color',
    'rgb(255, 0, 0)'
  );
  await expect(host.getByText('Styled inside scope')).toHaveCSS(
    'font-size',
    '32px'
  );
  await expect(host.getByText('Outside scope')).toHaveCSS(
    'color',
    'rgb(0, 0, 0)'
  );
});

test('preserves nested and body theme rules while stripping top-level head overrides', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const host = await mountHtml(
    page,
    'theme-rule-scope',
    '<head><style>@media(prefers-color-scheme:dark){.head{color:red}}@media screen{@media(prefers-color-scheme:dark){.nested{color:green}}}</style></head><body><style>@media(prefers-color-scheme:dark){.body{color:blue}}</style><p class="head">Head</p><p class="nested">Nested</p><p class="body">Body</p></body>',
    { theme: 'dark' }
  );
  await expect(host.getByText('Head', { exact: true })).toHaveCSS(
    'color',
    'rgb(0, 0, 0)'
  );
  await expect(host.getByText('Nested', { exact: true })).toHaveCSS(
    'color',
    'rgb(0, 128, 0)'
  );
  await expect(host.getByText('Body', { exact: true })).toHaveCSS(
    'color',
    'rgb(0, 0, 255)'
  );
});

test('keeps custom-property names consistent with selectors and container queries', async ({
  page,
}) => {
  const host = await mountHtml(
    page,
    'variable-names',
    '<style>[style*="--tone"] p{color:var(--tone)}@container style(--tone:red){p{font-size:32px}}</style><div style="--tone:red"><p>Variable styled text</p></div>'
  );
  const text = host.getByText('Variable styled text');
  await expect(text).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(text).toHaveCSS('font-size', '32px');
});

test('allows image-set backgrounds explicitly and blocks strings expanded by CSS functions', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://renderer.invalid/**', async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      contentType: 'image/png',
      body: imagePixel,
    });
  });
  await page.evaluate(() => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    for (const remote of ['allow', 'block'] as const) {
      const host = document.createElement('div');
      host.id = `image-set-${remote}`;
      document.body.append(host);
      const html = `<div style="--source:'https://renderer.invalid/${remote}-variable';background:image-set(var(--source) 1x)">Variable image</div><div style="background:image-set(env(no-such-environment,'https://renderer.invalid/${remote}-environment') 1x)">Environment image</div><div style="background:image-set('https://renderer.invalid/${remote}-direct' 1x)">Direct image</div>`;
      mountEmailBody(host, prepareEmailBody({ html }, { images: { remote } }), {
        theme: themes.light,
        adaptColors: false,
        normalizeFonts: false,
      });
    }
  });
  await expect
    .poll(() => requests.filter((url) => url.includes('/allow-')).length)
    .toBe(3);
  for (const label of ['Variable image', 'Environment image', 'Direct image'])
    await expect(page.locator('#image-set-block').getByText(label)).toHaveCSS(
      'background-image',
      'none'
    );
  expect(requests.filter((url) => url.includes('/block-'))).toEqual([]);
});

test('adapts text, links and status backgrounds after delayed attachment, exactly once', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const host = document.createElement('div');
    host.id = 'delayed-host';
    host.style.width = '600px';
    mountEmailBody(
      host,
      prepareEmailBody({
        html: '<div id="status" style="background-color:#fef7e0;color:#3c1e0a">A guest has accepted this invitation.</div><p id="details" style="color:#3c4043">When: Thursday at 7pm</p><a href="https://example.com">View all guest info</a>',
      }),
      { theme: themes.dark, adaptColors: true, normalizeFonts: false }
    );
    // Solid may construct a body before its parent/Suspense inserts the host.
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    document.body.append(host);
  });
  const host = page.locator('#delayed-host');
  await expect(host.locator('#status')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(host.locator('#details')).toHaveAttribute('style', /oklch/);
  await expect(host.locator('a')).toHaveCSS('color', 'oklch(0.75 0.15 250)');
  const styles = () =>
    host.evaluate((element) => element.shadowRoot!.innerHTML);
  const adapted = await styles();
  await host.evaluate((element) => {
    element.style.width = '400px';
  });
  await expect(host).toHaveCSS('width', '400px');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await styles()).toEqual(adapted);
});

test('prepares colors without waiting for an animation frame', async ({
  page,
}) => {
  const color = await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    const originalFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = mountEmailBody(
      host,
      prepareEmailBody({ html: '<a href="https://example.com">iOS</a>' }),
      { theme: themes.dark, adaptColors: true, normalizeFonts: false }
    );
    try {
      await Promise.resolve();
      return getComputedStyle(host.shadowRoot!.querySelector('a')!).color;
    } finally {
      renderer.dispose();
      host.remove();
      window.requestAnimationFrame = originalFrame;
    }
  });
  expect(color).toBe('oklch(0.75 0.15 250)');
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
  await expect(content).toHaveCSS('overflow-x', 'hidden');
  await expect(content).toHaveCSS('overflow-y', 'hidden');
  await expect(page.locator('#resize-host img')).toHaveCSS('display', 'none');
});

test('collapsed HTML stays within three lines without replacing image resources', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { prepareEmailBody, mountEmailBody, themes } = window.emailRenderer;
    // Match the reader's outer clamp. Containment must not let the full body
    // escape this summary when the renderer establishes its own layout boundary.
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'width:240px;font:16px/20px sans-serif;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden';
    const host = document.createElement('div');
    wrapper.append(host);
    document.body.append(wrapper);
    let resolutions = 0;
    const renderer = mountEmailBody(
      host,
      prepareEmailBody({
        html: `<p style="margin:0">${'A line of text<br>'.repeat(20)}</p><img src="cid:photo">`,
      }),
      {
        theme: themes.light,
        adaptColors: false,
        normalizeFonts: false,
        expanded: false,
        async resolveImages() {
          resolutions++;
        },
      }
    );
    const image = host.shadowRoot!.querySelector('img');
    const frame = () => new Promise(requestAnimationFrame);
    await frame();
    const collapsed = wrapper.getBoundingClientRect().height;
    renderer.setExpanded(true);
    await frame();
    const expanded = wrapper.getBoundingClientRect().height;
    renderer.setExpanded(false);
    await frame();
    const collapsedAgain = wrapper.getBoundingClientRect().height;
    const sameImage = host.shadowRoot!.querySelector('img') === image;
    renderer.dispose();
    wrapper.remove();
    return { collapsed, expanded, collapsedAgain, sameImage, resolutions };
  });
  expect(result.collapsed).toBe(60);
  expect(result.expanded).toBeGreaterThan(300);
  expect(result.collapsedAgain).toBe(60);
  expect(result.sameImage).toBe(true);
  expect(result.resolutions).toBe(1);
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
