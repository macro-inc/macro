import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';
import {
  receiveUpload,
  routeFixtures,
  svg,
  url,
} from './media-browser-fixtures';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/image-browser-test/fixture.html';

const sourceOnly = process.env.IMAGE_SOURCE_ONLY === '1';

async function capture(page: Page) {
  return page.evaluate(() => {
    if (!window.imageProofFixture)
      throw new Error('Missing actual image surface');
    return window.imageProofFixture.snapshot();
  });
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

const videoFile = new URL(
  '../../../../../../features/block-pptx/browser-test/fixtures/clip.webm',
  import.meta.url
);
for (const [label, outcome, intake] of [
  ['Image', 'success', 'picker'],
  ['Image', 'failure', 'picker'],
  ['Video', 'success', 'picker'],
  ['Video', 'failure', 'picker'],
  ['Video', 'success', 'clipboard'],
] as const) {
  test(`${label} upload ${outcome} uses the actual provider on Source and native via ${intake === 'clipboard' ? 'Source picker and native clipboard' : 'picker'}`, async ({
    browser,
    baseURL,
  }, info) => {
    const video = label === 'Video';
    const suffix = video ? '&video' : '';
    const file = video
      ? {
          name: 'clip.webm',
          mimeType: 'video/webm',
          buffer: readFileSync(videoFile),
        }
      : {
          name: 'fixture.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from(svg),
        };
    const contexts = await Promise.all(
      ['factory', 'source', 'native'].map(() => browser.newContext({ baseURL }))
    );
    await Promise.all(contexts.map(routeFixtures));
    const pages = await Promise.all(
      contexts.map((context) => context.newPage())
    );
    const [factory, source, native] = pages;
    if (!factory || !source || !native)
      throw new Error('Missing upload proof pages');
    const proofs = pages.map(watchCompiledSourceDeps);
    const records = [];
    let dependencyProofs: PromiseSettledResult<unknown>[] = [];
    let cleanup: PromiseSettledResult<void>[] = [];
    const errors: string[] = [];
    for (const page of pages)
      page.on('pageerror', (error) => errors.push(error.message));
    try {
      await factory.goto(`${path}?engine=factory&upload${suffix}`);
      await expect
        .poll(() => factory.evaluate(() => !!window.imageProofFixture))
        .toBe(true);
      const input = (await capture(factory)).model;
      for (const [engine, page] of [
        ['lexical', source],
        ['native', native],
      ] as const) {
        const id = '00000000-0000-4000-8000-000000000001';
        const receiver = await receiveUpload(outcome === 'success' ? 200 : 500);
        try {
          let reservations = 0;
          let discarded = 0;
          await page.route('**/api/file', (route) => {
            if (route.request().method() !== 'PUT') return route.fallback();
            reservations++;
            return route.fulfill({
              json: {
                id,
                file_location: '/fixture-file',
                upload_url: receiver.url,
              },
            });
          });
          await page.route(`**/api/file/${id}`, (route) => {
            if (route.request().method() !== 'DELETE') return route.fallback();
            discarded++;
            return route.fulfill({ status: 204 });
          });
          await page.addInitScript((model) => {
            window.imageProofInput = model;
          }, input);
          await page.bringToFront();
          await page.goto(`${path}?engine=${engine}&upload${suffix}`);
          const root = page.getByRole('textbox', { name: `${label} proof` });
          await expect
            .poll(() => page.evaluate(() => !!window.imageProofFixture))
            .toBe(true);
          await root.locator('p').first().click();
          await expect(root).toBeFocused();
          if (intake === 'clipboard' && engine === 'native') {
            expect(
              await page.evaluate(
                ({ name, mimeType, bytes }) => {
                  const clipboard = new DataTransfer();
                  clipboard.items.add(
                    new File([new Uint8Array(bytes)], name, { type: mimeType })
                  );
                  return window.imageProofFixture?.paste?.(clipboard);
                },
                {
                  name: file.name,
                  mimeType: file.mimeType,
                  bytes: Array.from(file.buffer),
                }
              )
            ).toBe(true);
          } else {
            await page.getByLabel(`${label} file`).setInputFiles(file);
          }
          await expect(root.getByText(`Saving ${label}...`)).toBeVisible();
          expect((await receiver.body).equals(file.buffer)).toBe(true);
          const media = root.locator(video ? 'video' : 'img');
          await expect(media).toBeVisible();
          if (video) await expect(media).toHaveAttribute('controls', '');
          const original = await media.elementHandle();
          const preview = await media.getAttribute('src');
          expect(preview).toMatch(/^blob:/);
          const pending = await capture(page);
          expect(pending.model).toContain('"srcType":"local"');
          receiver.release();
          await expect(root.getByText(`Saving ${label}...`)).toHaveCount(0);
          expect(
            await original.evaluate((element) => element.isConnected)
          ).toBe(true);
          await expect(media).toHaveAttribute('src', preview ?? '');
          const settled = await capture(page);
          if (outcome === 'success') {
            expect(settled.model).toContain('"srcType":"sfs"');
            expect(settled.model).toContain(`"id":"${id}"`);
            expect(settled.model).toContain(`/file/${id}`);
            expect(discarded).toBe(0);
          } else {
            await expect(
              page.getByText(`Failed to upload ${label.toLowerCase()}`)
            ).toBeVisible();
            expect(settled.model).toBe(pending.model);
            expect(discarded).toBe(1);
          }
          expect(reservations).toBe(1);
          expect(receiver.requests()).toBe(1);
          records.push({
            engine,
            pending,
            settled,
            reservations,
            writes: receiver.requests(),
            discarded,
          });
        } finally {
          await receiver.close();
        }
      }
      expect(errors).toEqual([]);
    } finally {
      try {
        dependencyProofs = await Promise.allSettled(
          proofs.map((finish) => finish())
        );
        await info.attach(`${label.toLowerCase()}-upload-raw.json`, {
          contentType: 'application/json',
          body: JSON.stringify({
            records,
            errors,
            compiledProofs: dependencyProofs.map((result) =>
              result.status === 'fulfilled'
                ? result.value
                : String(result.reason)
            ),
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
        await Promise.all(contexts.map((context) => context.close()));
      }
    }
    expect(dependencyProofs.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
  });
}

test('native video selection, cached setters and removal match Source', async ({
  context,
  baseURL,
}, info) => {
  await routeFixtures(context);
  const mediaUrl = new URL(
    '/src/features/block-pptx/browser-test/fixtures/clip.webm',
    baseURL
  ).href;
  const factory = await context.newPage();
  const source = await context.newPage();
  const native = sourceOnly ? undefined : await context.newPage();
  const pages = native ? [factory, source, native] : [factory, source];
  const proofs = pages.map(watchCompiledSourceDeps);
  const errors: string[] = [];
  for (const page of pages)
    page.on('pageerror', (error) => errors.push(error.message));
  const records = [];
  let cleanup: PromiseSettledResult<void>[] = [];
  let compiledProofs: PromiseSettledResult<unknown>[] = [];
  const root = (page: Page) =>
    page.getByRole('textbox', { name: 'Video proof' });
  const video = (page: Page) => root(page).locator('video').first();
  const loaded = async (page: Page) => {
    await expect(video(page)).toBeVisible();
    await expect
      .poll(() =>
        video(page).evaluate(
          (element) =>
            element instanceof HTMLVideoElement && element.videoWidth > 0
        )
      )
      .toBe(true);
    await expect(video(page)).toHaveAttribute('controls', '');
  };
  try {
    await factory.bringToFront();
    await factory.goto(`${path}?engine=factory&video`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(root(factory)).toBeVisible();
    await expect(video(factory)).toHaveAttribute('src', mediaUrl);
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
      await page.goto(`${path}?engine=${engine}&video`, {
        waitUntil: 'domcontentloaded',
      });
      await loaded(page);
      const stages = [await capture(page)];
      records.push({ engine, stages });
      const settlePointer = async () => {
        await page.mouse.move(999, 799);
        await expect(
          root(page).locator('.transition-all.duration-200').first()
        ).toHaveCSS('opacity', '0');
      };
      // Browser playback widgets can consume trusted video clicks. Exercise the
      // shared decorator click handler without invoking the engine's player UI.
      await video(page).dispatchEvent('click', {}, { timeout: 5_000 });
      await expect(root(page).locator('.ring-3')).toHaveCount(1);
      await settlePointer();
      stages.push(await capture(page));
      const original = await video(page).elementHandle();
      const portal = await original.evaluateHandle(
        (element) =>
          element.closest('[data-lexical-decorator]')?.firstElementChild
      );
      const nextUrl = `${mediaUrl}?revision=1`;
      await page.evaluate(
        (value) => window.imageProofFixture?.setUrl(value, false),
        nextUrl
      );
      await expect(video(page)).toHaveAttribute('src', mediaUrl);
      expect(await original.evaluate((element) => element.isConnected)).toBe(
        true
      );
      stages.push(await capture(page));
      await page.evaluate(
        (value) => window.imageProofFixture?.setUrl(value, true),
        nextUrl
      );
      await expect(video(page)).toHaveAttribute('src', nextUrl);
      await loaded(page);
      await settlePointer();
      expect(await original.evaluate((element) => element.isConnected)).toBe(
        false
      );
      expect(await portal.evaluate((element) => element?.isConnected)).toBe(
        true
      );
      stages.push(await capture(page));
      const actions = root(page).locator('.top-2.right-2 button');
      await expect(actions).toHaveCount(3);
      await actions.last().click();
      await expect(video(page)).toHaveCount(0);
      stages.push(await capture(page));
    }
    if (native) expect(records[1]?.stages).toEqual(records[0]?.stages);
    expect(errors).toEqual([]);
  } finally {
    try {
      compiledProofs = await Promise.allSettled(
        proofs.map((finish) => finish())
      );
      await info.attach('video-raw.json', {
        contentType: 'application/json',
        body: JSON.stringify({
          records,
          errors,
          compiledProofs: compiledProofs.map((result) =>
            result.status === 'rejected'
              ? { error: String(result.reason) }
              : result.value
          ),
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
  expect(compiledProofs.map((result) => result.status)).toEqual(
    pages.map(() => 'fulfilled')
  );
  expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
});
