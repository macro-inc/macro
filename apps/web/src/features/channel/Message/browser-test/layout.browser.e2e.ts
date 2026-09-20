import { expect, type Page, type Route, test } from '@playwright/test';

async function delayedNetwork(
  page: Page,
  mode: 'success' | 'empty' | 'error' | 'image-error'
) {
  let metadataReady = false;
  let imagesReady = false;
  const metadata: Route[] = [];
  const images: Route[] = [];
  const respond = async (route: Route) => {
    if (mode === 'error') return route.fulfill({ status: 503, body: '{}' });
    const { url_list } = route.request().postDataJSON() as {
      url_list: string[];
    };
    await route.fulfill({
      json: {
        responses: url_list.map((url) =>
          mode === 'empty'
            ? { url, title: url }
            : {
                url,
                title: `Loaded article ${url.split('-').at(-1)} with a longer title that wraps`,
                description:
                  'Delayed metadata must not move the surrounding messages. This description is deliberately long enough to wrap at narrow widths.',
                image_url: `${new URL(page.url()).origin}/__image/${url.split('-').at(-1)}`,
              }
        ),
      },
    });
  };
  await page.route('**/__unfurl', (route) =>
    metadataReady ? respond(route) : void metadata.push(route)
  );
  const respondImage = (route: Route) =>
    mode === 'image-error'
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#dbeafe"/><circle cx="600" cy="300" r="200" fill="#2563eb"/></svg>',
        });
  await page.route('**/__image/*', (route) =>
    imagesReady ? respondImage(route) : void images.push(route)
  );
  return {
    async metadata() {
      metadataReady = true;
      await Promise.all(metadata.splice(0).map(respond));
    },
    async images() {
      imagesReady = true;
      await Promise.all(images.splice(0).map(respondImage));
    },
    pending: () => metadata.length,
  };
}

async function geometry(page: Page, id: string) {
  return page.getByTestId(`message-${id}`).evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    anchor: element
      .querySelector('[data-testid^="anchor-"]')!
      .getBoundingClientRect().top,
  }));
}

for (const width of [1100, 375]) {
  for (const mode of ['success', 'empty', 'error', 'image-error'] as const) {
    test(`${width}px: ${mode} preserves message height and surrounding content`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      const network = await delayedNetwork(page, mode);
      page.on('pageerror', (error) => console.error(error.message));
      await page.goto('/');
      await expect.poll(network.pending).toBeGreaterThan(0);
      await page.getByTestId('composer').fill('My draft stays here');
      const before = await geometry(page, '0');
      await page.waitForTimeout(1600); // Deliberate pause for the recorded loading state.
      await network.metadata();
      if (mode === 'success' || mode === 'image-error')
        await expect(
          page.getByRole('link', { name: /Loaded article 0/ }).first()
        ).toBeVisible();
      else
        await expect(
          page.getByTestId('message-0').locator('[data-link-preview]')
        ).toHaveAttribute('aria-busy', 'false');
      expect(await geometry(page, '0')).toEqual(before);
      await page.waitForTimeout(1600); // Record metadata before image decoding.
      await network.images();
      if (mode === 'success')
        await expect
          .poll(() =>
            page
              .locator('[data-link-preview] img')
              .first()
              .evaluate(
                (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
              )
          )
          .toBe(true);
      if (mode === 'image-error')
        await expect(page.locator('[data-link-preview] img')).toHaveCount(0);
      expect(await geometry(page, '0')).toEqual(before);
      await expect(page.getByTestId('max-height-change')).toHaveText('0px');
      await expect(page.getByTestId('suspension-count')).toHaveText('0');
      await expect(page.getByTestId('channel-suspended')).toHaveCount(0);
      await expect(page.getByTestId('composer')).toHaveValue(
        'My draft stays here'
      );
      await page.waitForTimeout(1600);
      await expect(page.getByTestId('max-height-change')).toHaveText('0px');
      await expect(page.getByTestId('suspension-count')).toHaveText('0');
    });
  }
}

for (const position of ['latest', 'history'] as const) {
  test(`virtual channel keeps its ${position} anchor through late previews`, async ({
    page,
  }) => {
    const network = await delayedNetwork(page, 'success');
    await page.goto('/?virtual');
    const scroller = page.locator('[data-channel-scroll]');
    await expect.poll(network.pending).toBeGreaterThan(0);
    await expect(page.getByTestId('message-34')).toBeVisible();
    if (position === 'history') {
      await scroller.hover();
      await page.mouse.wheel(0, -600);
      await expect
        .poll(() =>
          scroller.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop
          )
        )
        .toBeGreaterThan(400);
    }
    const id = await scroller.evaluate((el) =>
      [...el.querySelectorAll('[data-testid^="message-"]')]
        .find(
          (row) =>
            row.getBoundingClientRect().top >= el.getBoundingClientRect().top
        )
        ?.getAttribute('data-testid')
        ?.replace('message-', '')
    );
    expect(id).toBeTruthy();
    const before = await geometry(page, id!);
    await network.metadata();
    await expect(
      page
        .getByTestId(`message-${id}`)
        .getByRole('link', { name: /Loaded article/ })
        .first()
    ).toBeVisible();
    await network.images();
    await expect
      .poll(() =>
        page
          .getByTestId(`message-${id}`)
          .locator('img')
          .first()
          .evaluate((img: HTMLImageElement) => img.complete)
      )
      .toBe(true);
    expect(await geometry(page, id!)).toEqual(before);
    await expect(page.getByTestId('max-height-change')).toHaveText('0px');
    await expect(page.getByTestId('suspension-count')).toHaveText('0');
    await expect(page.getByTestId('channel-suspended')).toHaveCount(0);
    if (position === 'latest')
      expect(
        await scroller.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop
        )
      ).toBeLessThan(2);
  });
}

const extractionCases = [
  { name: 'plain text', content: 'No links here', count: 0 },
  {
    name: 'internal app links',
    content: 'https://macro.com/app/channel/abc',
    count: 0,
  },
  { name: 'inline code', content: '`curl https://example.com/a`', count: 0 },
  {
    name: 'fenced code',
    content: '```\ncurl https://example.com/a\n```',
    count: 0,
  },
  {
    name: 'sender-suppressed link',
    content:
      '<m-link>{"url":"https://example.com/a","text":"a","preview":false}</m-link>',
    count: 0,
  },
  {
    name: 'duplicate links',
    content: 'https://example.com/a https://example.com/a',
    count: 1,
  },
  {
    name: 'trailing punctuation',
    content: 'Read https://example.com/a.',
    count: 1,
  },
  {
    name: 'markdown link',
    content: '[Read this](https://example.com/a)',
    count: 1,
  },
  {
    name: 'three-card limit',
    content:
      'https://example.com/a https://example.com/b https://example.com/c https://example.com/d',
    count: 3,
  },
];
for (const scenario of extractionCases) {
  test(`extraction: ${scenario.name}`, async ({ page }) => {
    const network = await delayedNetwork(page, 'success');
    await page.goto(`/?content=${encodeURIComponent(scenario.content)}`);
    await expect(page.getByTestId('message-0')).toBeVisible();
    await expect(page.locator('[data-link-preview]')).toHaveCount(
      scenario.count
    );
    if (scenario.count) {
      await expect.poll(network.pending).toBeGreaterThan(0);
      const before = await geometry(page, '0');
      await network.metadata();
      await network.images();
      await expect(
        page.locator('[data-link-preview][aria-busy="true"]')
      ).toHaveCount(0);
      expect(await geometry(page, '0')).toEqual(before);
    }
    await expect(page.getByTestId('suspension-count')).toHaveText('0');
  });
}

test('visibility preference persists and warm-cache remount has identical geometry', async ({
  page,
}) => {
  const network = await delayedNetwork(page, 'success');
  await page.goto('/');
  await expect.poll(network.pending).toBeGreaterThan(0);
  const cold = await geometry(page, '0');
  await network.metadata();
  await network.images();
  await expect(
    page.getByRole('link', { name: /Loaded article 0/ }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Unmount previews' }).click();
  await expect(page.locator('[data-link-preview]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remount previews' }).click();
  await expect(page.locator('[data-link-preview]')).toHaveCount(3);
  expect(await geometry(page, '0')).toEqual(cold);
  await page.getByRole('checkbox', { name: 'Show link previews' }).uncheck();
  await expect(page.locator('[data-link-preview]')).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: 'Show link previews' })
  ).not.toBeChecked();
  await expect(page.locator('[data-link-preview]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show link previews' }).check();
  await expect(page.locator('[data-link-preview]')).toHaveCount(3);
});

for (const state of ['other-sender', 'deleted'] as const) {
  test(`sender controls: ${state}`, async ({ page }) => {
    await delayedNetwork(page, 'success');
    await page.goto(`/?${state}`);
    await expect(page.getByTestId('message-0')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove link preview' })
    ).toHaveCount(0);
    await expect(page.locator('[data-link-preview]')).toHaveCount(
      state === 'deleted' ? 0 : 3
    );
  });
}

for (const firstFailure of [0, 1]) {
  test(`concurrent failed removals restore both cards in order ${firstFailure}`, async ({
    page,
  }) => {
    const network = await delayedNetwork(page, 'success');
    const removals: Route[] = [];
    await page.route('**/__remove-preview', (route) => {
      removals.push(route);
    });
    await page.goto('/?content=https://example.com/a%20https://example.com/b');
    await expect.poll(network.pending).toBeGreaterThan(0);
    await network.metadata();
    await network.images();
    const cards = page.locator('[data-link-preview]');
    await expect(cards).toHaveCount(2);
    const before = await geometry(page, '0');
    await page.getByTestId('composer').fill('Draft survives failed removals');
    for (let index = 0; index < 2; index++) {
      await cards.first().hover();
      await cards
        .first()
        .getByRole('button', { name: 'Remove link preview' })
        .click();
    }
    await expect(cards).toHaveCount(0);
    await expect.poll(() => removals.length).toBe(2);
    await removals[firstFailure].fulfill({ status: 500, body: '{}' });
    await expect(cards).toHaveCount(1);
    await removals[1 - firstFailure].fulfill({ status: 500, body: '{}' });
    await expect(cards).toHaveCount(2);
    expect(await geometry(page, '0')).toEqual(before);
    await expect(page.getByTestId('composer')).toHaveValue(
      'Draft survives failed removals'
    );
    await expect(page.getByTestId('suspension-count')).toHaveText('0');
    await page.reload();
    await expect(cards).toHaveCount(2);
  });
}

test('successful removal stays hidden after reload', async ({ page }) => {
  await delayedNetwork(page, 'success');
  await page.route('**/__remove-preview', (route) =>
    route.fulfill({ status: 200, json: {} })
  );
  await page.goto('/?content=https://example.com/a');
  const cards = page.locator('[data-link-preview]');
  await expect(cards).toHaveCount(1);
  const removed = page.waitForResponse('**/__remove-preview');
  await cards.first().hover();
  await cards
    .first()
    .getByRole('button', { name: 'Remove link preview' })
    .click();
  await (await removed).finished();
  await expect(cards).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('message-0')).toBeVisible();
  await expect(cards).toHaveCount(0);
});
