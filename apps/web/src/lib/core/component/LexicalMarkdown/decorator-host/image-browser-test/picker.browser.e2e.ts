import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';
import { receiveUpload, routeFixtures, svg } from './media-browser-fixtures';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/image-browser-test/fixture.html';
const video = readFileSync(
  new URL(
    '../../../../../../features/block-pptx/browser-test/fixtures/clip.webm',
    import.meta.url
  )
);

test('media dialog uploads both kinds at the eventual selection on Source and native', async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({ baseURL });
  await routeFixtures(context);
  const factory = await context.newPage();
  const records = [];
  const errors: string[] = [];
  try {
    await factory.goto(`${path}?engine=factory&upload&picker`);
    await expect
      .poll(() => factory.evaluate(() => !!window.imageProofFixture))
      .toBe(true);
    const model = await factory.evaluate(
      () => window.imageProofFixture?.snapshot().model
    );
    if (!model) throw new Error('Missing factory model');
    for (const engine of ['lexical', 'native']) {
      const page = await context.newPage();
      const finish = watchCompiledSourceDeps(page);
      page.on('pageerror', (error) => errors.push(error.message));
      const imageUpload = await receiveUpload(200);
      const videoUpload = await receiveUpload(200);
      const reservations: string[] = [];
      try {
        await page.route('**/api/file', (route) => {
          if (route.request().method() !== 'PUT') return route.fallback();
          const body: unknown = route.request().postDataJSON();
          if (
            !body ||
            typeof body !== 'object' ||
            !('file_name' in body) ||
            typeof body.file_name !== 'string'
          )
            throw new Error('Missing actual file reservation name');
          reservations.push(body.file_name);
          const image = body.file_name === 'picker.svg';
          return route.fulfill({
            json: {
              id: image
                ? '00000000-0000-4000-8000-000000000011'
                : '00000000-0000-4000-8000-000000000012',
              file_location: '/fixture-file',
              upload_url: image ? imageUpload.url : videoUpload.url,
            },
          });
        });
        await page.addInitScript((model) => {
          window.imageProofInput = model;
        }, model);
        await page.goto(`${path}?engine=${engine}&upload&picker`);
        const root = page.getByRole('textbox', { name: 'Image proof' });
        await expect
          .poll(() => page.evaluate(() => !!window.imageProofFixture))
          .toBe(true);
        await root.locator('p').first().click();
        const chooserPromise = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Choose media' }).click();
        const chooser = await chooserPromise;
        expect(chooser.isMultiple()).toBe(true);
        const dialog = await chooser.element().evaluate((input) => {
          if (!(input instanceof HTMLInputElement))
            throw new Error('Missing actual file input');
          return input.outerHTML;
        });
        expect(await chooser.element().getAttribute('accept')).toBe(
          'image/*,video/*'
        );
        await page.evaluate(() => window.imageProofFixture?.footer());
        await chooser.setFiles([
          {
            name: 'picker.svg',
            mimeType: 'image/svg+xml',
            buffer: Buffer.from(svg),
          },
          { name: 'picker.webm', mimeType: 'video/webm', buffer: video },
        ]);
        await expect(root.getByText('Saving Image...')).toBeVisible();
        await expect(root.getByText('Saving Video...')).toBeVisible();
        expect((await imageUpload.body).equals(Buffer.from(svg))).toBe(true);
        expect((await videoUpload.body).equals(video)).toBe(true);
        const pending = await page.evaluate(() =>
          window.imageProofFixture?.snapshot()
        );
        const image = root.locator('img');
        const player = root.locator('video');
        await expect(image).toBeVisible();
        await expect(player).toBeVisible();
        const previewImage = await image.elementHandle();
        const previewVideo = await player.elementHandle();
        expect(pending?.model.indexOf('Footer')).toBeLessThan(
          pending?.model.indexOf('"type":"image"') ?? -1
        );
        expect(pending?.model.indexOf('Footer')).toBeLessThan(
          pending?.model.indexOf('"type":"video"') ?? -1
        );
        imageUpload.release();
        videoUpload.release();
        await expect(root.getByText('Saving Image...')).toHaveCount(0);
        await expect(root.getByText('Saving Video...')).toHaveCount(0);
        expect(
          await previewImage?.evaluate((element) => element.isConnected)
        ).toBe(true);
        expect(
          await previewVideo?.evaluate((element) => element.isConnected)
        ).toBe(true);
        const settled = await page.evaluate(() =>
          window.imageProofFixture?.snapshot()
        );
        expect(settled?.model).toContain(
          '"id":"00000000-0000-4000-8000-000000000011"'
        );
        expect(settled?.model).toContain(
          '"id":"00000000-0000-4000-8000-000000000012"'
        );
        expect(reservations.sort()).toEqual(['picker.svg', 'picker.webm']);
        expect(imageUpload.requests()).toBe(1);
        expect(videoUpload.requests()).toBe(1);
        expect(
          await chooser.element().evaluate((input) => input.isConnected)
        ).toBe(false);
        records.push({
          engine,
          dialog,
          pending,
          settled,
          compiled: await finish(),
        });
      } finally {
        let cleanup: PromiseSettledResult<unknown>[] = [];
        try {
          cleanup = await Promise.allSettled([
            page.evaluate(() => window.imageProofClose?.()),
            imageUpload.close(),
            videoUpload.close(),
          ]);
        } finally {
          await page.close();
        }
        expect(cleanup.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
          'fulfilled',
        ]);
      }
    }
    expect(records[1]?.dialog).toBe(records[0]?.dialog);
    expect(errors).toEqual([]);
  } finally {
    try {
      await info.attach('picker-raw.json', {
        contentType: 'application/json',
        body: JSON.stringify({ records, errors }),
      });
    } finally {
      try {
        await factory.evaluate(() => window.imageProofClose?.());
      } finally {
        await context.close();
      }
    }
  }
});

test('native picker cancels and retires readonly and disposed dialogs', async ({
  context,
}, info) => {
  await routeFixtures(context);
  const factory = await context.newPage();
  const page = await context.newPage();
  const finish = watchCompiledSourceDeps(page);
  try {
    await factory.goto(`${path}?engine=factory&upload&picker`);
    await expect
      .poll(() => factory.evaluate(() => !!window.imageProofFixture))
      .toBe(true);
    const model = await factory.evaluate(
      () => window.imageProofFixture?.snapshot().model
    );
    if (!model) throw new Error('Missing actual factory model');
    let reservations = 0;
    await page.route('**/api/file', (route) => {
      reservations++;
      return route.abort();
    });
    await page.addInitScript((model) => {
      window.imageProofInput = model;
    }, model);
    await page.goto(`${path}?engine=native&upload&picker`);
    await expect
      .poll(() => page.evaluate(() => !!window.imageProofFixture))
      .toBe(true);
    await page.evaluate(() => window.imageProofFixture?.editable(false));
    expect(
      await page.evaluate(() => window.imageProofFixture?.openDialog())
    ).toBe(false);
    await page.evaluate(() => window.imageProofFixture?.editable(true));
    for (const kind of ['image', 'video', 'all'] as const) {
      const chooserPromise = page.waitForEvent('filechooser');
      expect(
        await page.evaluate(
          (kind) => window.imageProofFixture?.openDialog(kind),
          kind
        )
      ).toBe(true);
      const chooser = await chooserPromise;
      expect(await chooser.element().getAttribute('accept')).toBe(
        kind === 'all' ? 'image/*,video/*' : `${kind}/*`
      );
      await chooser.element().dispatchEvent('cancel');
      expect(
        await chooser.element().evaluate((input) => input.isConnected)
      ).toBe(false);
    }
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose media' }).click();
    const stale = await chooserPromise;
    await page.evaluate(() => window.imageProofFixture?.editable(false));
    const before = await page.evaluate(() =>
      window.imageProofFixture?.snapshot()
    );
    await stale.setFiles({
      name: 'stale.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(svg),
    });
    expect(
      await page.evaluate(() => window.imageProofFixture?.snapshot())
    ).toEqual(before);
    await page.evaluate(() => window.imageProofFixture?.editable(true));
    const disposeChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose media' }).click();
    const pending = await disposeChooser;
    await page.evaluate(() => window.imageProofFixture?.retireUploads?.());
    expect(await pending.element().evaluate((input) => input.isConnected)).toBe(
      false
    );
    expect(
      await page.evaluate(() => window.imageProofFixture?.openDialog())
    ).toBe(false);
    expect(reservations).toBe(0);
    await info.attach('picker-lifecycle.json', {
      contentType: 'application/json',
      body: JSON.stringify({ before, reservations, compiled: await finish() }),
    });
  } finally {
    let cleanup: PromiseSettledResult<unknown>[] = [];
    try {
      cleanup = await Promise.allSettled([
        page.evaluate(() => window.imageProofClose?.()),
        factory.evaluate(() => window.imageProofClose?.()),
      ]);
    } finally {
      await Promise.all([page.close(), factory.close()]);
    }
    expect(cleanup.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
  }
});
