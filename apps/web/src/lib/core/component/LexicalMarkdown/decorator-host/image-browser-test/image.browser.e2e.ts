import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/image-browser-test/fixture.html';
const url = 'https://static.klipy.com/fixture/image.svg';
const sourceOnly = process.env.IMAGE_SOURCE_ONLY === '1';
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="#456789"/></svg>';

async function capture(page: Page) {
  return page.evaluate(() => {
    if (!window.imageProofFixture)
      throw new Error('Missing actual image surface');
    return window.imageProofFixture.snapshot();
  });
}

async function routeFixtures(context: BrowserContext) {
  await context.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  await context.route('https://static.klipy.com/fixture/image.svg*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: svg,
    })
  );
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  await routeFixtures(context);
  const page = await context.newPage();
  try {
    await page.goto(`${path}?engine=factory`);
    await expect(
      page.getByRole('textbox', { name: 'Image proof' }).getByRole('img')
    ).toBeVisible();
  } finally {
    try {
      await page.evaluate(() => window.imageProofClose?.());
    } finally {
      await context.close();
    }
  }
});

test('native image selection, cached setters and removal match Source', async ({
  context,
}, info) => {
  await routeFixtures(context);
  const factory = await context.newPage();
  const source = await context.newPage();
  const native = sourceOnly ? undefined : await context.newPage();
  const pages = native ? [factory, source, native] : [factory, source];
  const proofs = pages.map(watchCompiledSourceDeps);
  const errors: string[] = [];
  for (const page of pages)
    page.on('pageerror', (error) => errors.push(error.message));
  const records = [];
  const focus = [];
  const image = (page: Page) =>
    page.getByRole('textbox', { name: 'Image proof' }).getByRole('img');
  const loaded = async (page: Page) => {
    await expect(image(page)).toBeVisible();
    await expect
      .poll(() =>
        image(page).evaluate((element) =>
          element instanceof HTMLImageElement ? element.naturalWidth : 0
        )
      )
      .toBe(256);
  };
  try {
    await factory.goto(`${path}?engine=factory`);
    await loaded(factory);
    const input = (await capture(factory)).model;
    for (const [engine, page] of [
      ['lexical', source],
      ['native', native],
    ] as const) {
      if (!page) continue;
      await page.addInitScript((model) => {
        window.imageProofInput = model;
      }, input);
      await page.bringToFront();
      await page.goto(`${path}?engine=${engine}`);
      await loaded(page);
      const stages = [await capture(page)];
      records.push({ engine, stages });
      const root = page.getByRole('textbox', { name: 'Image proof' });
      const settlePointer = async () => {
        await page.mouse.move(999, 799);
        await expect(
          root.locator('.transition-all.duration-200').first()
        ).toHaveCSS('opacity', '0');
      };
      await image(page).click();
      focus.push({
        engine,
        root: await root.evaluate(
          (element) => element.ownerDocument.activeElement === element
        ),
      });
      await settlePointer();
      await expect(
        page.getByRole('textbox', { name: 'Image proof' }).locator('.ring-3')
      ).toHaveCount(1);
      stages.push(await capture(page));
      const original = await image(page).elementHandle();
      const host = await original.evaluateHandle(
        (element) =>
          element.closest('[data-lexical-decorator]')?.firstElementChild
      );
      const changed = `${url}?revision=1`;
      await page.evaluate(
        (value) => window.imageProofFixture?.setUrl(value, false),
        changed
      );
      await expect(image(page)).toHaveAttribute('src', url);
      expect(await original.evaluate((element) => element.isConnected)).toBe(
        true
      );
      stages.push(await capture(page));
      await page.evaluate(
        (value) => window.imageProofFixture?.setUrl(value, true),
        changed
      );
      await expect(image(page)).toHaveAttribute('src', changed);
      await loaded(page);
      await settlePointer();
      expect(await original.evaluate((element) => element.isConnected)).toBe(
        false
      );
      expect(await host.evaluate((element) => element?.isConnected)).toBe(true);
      stages.push(await capture(page));
      await image(page).click();
      const mediaActions = root.locator('.top-2.right-2 button');
      await expect(mediaActions).toHaveCount(3);
      await mediaActions.last().click();
      await expect(image(page)).toHaveCount(0);
      stages.push(await capture(page));
    }
    if (native) expect(records[1]?.stages).toEqual(records[0]?.stages);
    expect(errors).toEqual([]);
  } finally {
    try {
      await info.attach('image-raw.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          records,
          focus,
          errors,
          compiledProofs: await Promise.all(proofs.map((finish) => finish())),
        }),
      });
    } finally {
      for (const page of pages) {
        try {
          await page.evaluate(() => window.imageProofClose?.());
        } finally {
          await page.close();
        }
      }
    }
  }
});

for (const key of ['Backspace', 'Delete']) {
  test(`native ${key} deletes the selected decorator like Source`, async ({
    context,
  }, info) => {
    await routeFixtures(context);
    const factory = await context.newPage();
    const source = await context.newPage();
    const native = await context.newPage();
    const pages = [factory, source, native];
    const proofs = pages.map(watchCompiledSourceDeps);
    const errors: string[] = [];
    for (const page of pages)
      page.on('pageerror', (error) => errors.push(error.message));
    const records = [];
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      await factory.goto(`${path}?engine=factory`);
      await expect(
        factory.getByRole('textbox', { name: 'Image proof' }).getByRole('img')
      ).toBeVisible();
      const input = (await capture(factory)).model;
      for (const [engine, page] of [
        ['lexical', source],
        ['native', native],
      ] as const) {
        await page.addInitScript((model) => {
          window.imageProofInput = model;
        }, input);
        await page.bringToFront();
        await page.goto(`${path}?engine=${engine}`);
        const root = page.getByRole('textbox', { name: 'Image proof' });
        const image = root.getByRole('img');
        await expect(image).toBeVisible();
        await image.click();
        await expect(root.locator('.ring-3')).toHaveCount(1);
        await expect(root).toBeFocused();
        await page.keyboard.press(key);
        const after = await capture(page);
        const submitted = await page.evaluate(() =>
          window.imageProofFixture?.keyAdmissions()
        );
        records.push({ engine, after, submitted });
        await expect.soft(image).toHaveCount(0);
      }
      const sourceRecord = records.find((row) => row.engine === 'lexical');
      const nativeRecord = records.find((row) => row.engine === 'native');
      expect
        .soft(nativeRecord?.submitted)
        .toEqual([{ key, cached: 'node', submitted: 'keep' }]);
      expect.soft(nativeRecord?.after).toEqual(sourceRecord?.after);
      expect(errors).toEqual([]);
    } finally {
      try {
        await info.attach('decorator-keydown-raw.json', {
          contentType: 'application/json',
          body: JSON.stringify({
            records,
            errors,
            compiledProofs: await Promise.all(proofs.map((finish) => finish())),
          }),
        });
      } finally {
        cleanup = await Promise.allSettled(
          pages.map(async (page) => {
            try {
              await page.evaluate(() => window.imageProofClose?.());
            } finally {
              await page.close();
            }
          })
        );
      }
    }
    expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
  });
}
