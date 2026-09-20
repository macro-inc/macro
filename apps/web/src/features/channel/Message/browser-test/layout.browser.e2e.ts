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
