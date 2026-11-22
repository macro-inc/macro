import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import { receiveUpload } from '../image-browser-test/media-browser-fixtures';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/gif-browser-test/fixture.html';
const gif = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64'
);

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await context.route('**/__macro_dev/gateway/**', (route) =>
    route.fulfill({ json: { links: [] } })
  );
  try {
    await page.goto(`${path}?engine=factory`);
    await expect
      .poll(() => page.evaluate(() => !!window.gifProofFixture))
      .toBe(true);
  } finally {
    try {
      await page.evaluate(() => window.gifProofClose?.());
    } finally {
      await context.close();
    }
  }
});

for (const delayedCommit of [false, true]) {
  test(`actual Source GIF picker and successful upload retain literal UI and model stages${delayedCommit ? ' with delayed completion' : ''}`, async ({
    context,
  }, info) => {
    const factory = await context.newPage();
    const page = await context.newPage();
    const witnesses = [factory, page].map(watchCompiledSourceDeps);
    const receiver = await receiveUpload(200);
    const records = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let reservations = 0;
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ json: { links: [] } })
    );
    await context.route('https://api.klipy.com/v2/*?*', (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') ?? '';
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          results: [
            {
              id: 'fixture-gif',
              title: `${query || 'Trending'} animation`,
              media_formats: {
                mediumgif: {
                  url: 'https://example.test/animation.gif',
                  dims: [800, 400],
                },
                tinygif: {
                  url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
                  dims: [1, 1],
                },
              },
            },
          ],
        },
      });
    });
    await context.route(
      '**/static/file/00000000-0000-4000-8000-000000000032*',
      (route) =>
        route.fulfill({
          body: gif,
          contentType: 'image/gif',
          headers: { 'access-control-allow-origin': '*' },
        })
    );
    await context.route('https://example.test/animation.gif', (route) =>
      route.fulfill({
        body: gif,
        contentType: 'image/gif',
        headers: { 'access-control-allow-origin': '*' },
      })
    );
    await context.route('**/api/file', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      reservations++;
      return route.fulfill({
        json: {
          id: '00000000-0000-4000-8000-000000000032',
          file_location: '/animation',
          upload_url: receiver.url,
        },
      });
    });
    try {
      await factory.goto(`${path}?engine=factory`);
      await expect
        .poll(() => factory.evaluate(() => !!window.gifProofFixture))
        .toBe(true);
      const model = await factory.evaluate(
        () => window.gifProofFixture?.capture().model
      );
      if (!model) throw new Error('Missing Source factory output');
      await page.addInitScript((model) => {
        window.gifProofInput = model;
      }, model);
      await page.goto(
        `${path}?engine=lexical${delayedCommit ? '&asyncSource' : ''}`
      );
      await expect
        .poll(() => page.evaluate(() => !!window.gifProofFixture))
        .toBe(true);
      await page.evaluate(() => window.gifProofFixture?.select());
      records.push(
        await page.evaluate(() => window.gifProofFixture?.capture())
      );
      await page.getByRole('button', { name: 'Open GIF' }).click();
      const input = page.getByRole('searchbox', { name: 'Search GIFs' });
      await expect(input).toBeFocused();
      await expect(
        page.getByRole('button', { name: 'Trending animation', exact: true })
      ).toBeVisible();
      records.push(
        await page.evaluate(() => window.gifProofFixture?.capture())
      );
      await input.fill('orbit');
      const choice = page.getByRole('button', {
        name: 'orbit animation',
        exact: true,
      });
      await expect(choice).toBeVisible();
      records.push(
        await page.evaluate(() => window.gifProofFixture?.capture())
      );
      await choice.click();
      expect((await receiver.body).equals(gif)).toBe(true);
      await expect(choice).toBeDisabled();
      records.push(
        await page.evaluate(() => window.gifProofFixture?.capture())
      );
      receiver.release();
      await expect(input).toHaveCount(0);
      if (delayedCommit) {
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.gifProofFixture?.pendingSourceCommits?.()
            )
          )
          .toBe(1);
        expect(
          await page.evaluate(() => window.gifProofFixture?.open?.())
        ).toBe(true);
        await expect(input).toBeFocused();
        await page.evaluate(() =>
          window.gifProofFixture?.completeSourceCommits?.()
        );
        await expect
          .poll(() =>
            page.evaluate(() =>
              window.gifProofFixture?.pendingSourceCommits?.()
            )
          )
          .toBe(0);
        await expect(input).toBeFocused();
        await page.keyboard.press('Escape');
      }
      const root = page.getByRole('textbox', { name: 'GIF proof' });
      await expect(root.locator('img')).toHaveCount(1);
      await expect(root).toBeFocused();
      const final = await page.evaluate(() =>
        window.gifProofFixture?.capture()
      );
      expect(final?.model).toContain('"srcType":"sfs"');
      expect(final?.model).toContain('"constrainedWidth":400');
      expect(final?.model).toContain('"constrainedHeight":200');
      records.push(final);
      expect(reservations).toBe(1);
      expect(receiver.requests()).toBe(1);
      expect(errors).toEqual([]);
      if (process.env.GIF_SOURCE_CAPTURE && !delayedCommit)
        writeFileSync(
          `${process.env.GIF_SOURCE_CAPTURE}/${info.project.name}.json`,
          JSON.stringify(records)
        );
    } finally {
      try {
        const compiled = await Promise.allSettled(
          witnesses.map((finish) => finish())
        );
        await info.attach('source-gif.json', {
          contentType: 'application/json',
          body: JSON.stringify({
            records,
            errors,
            compiled: compiled.map((result) =>
              result.status === 'fulfilled'
                ? { status: result.status, value: result.value }
                : { status: result.status, reason: String(result.reason) }
            ),
          }),
        });
        expect(compiled.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      } finally {
        let cleanup: PromiseSettledResult<unknown>[] = [];
        try {
          cleanup = await Promise.allSettled([
            factory.evaluate(() => window.gifProofClose?.()),
            page.evaluate(() => window.gifProofClose?.()),
            receiver.close(),
          ]);
        } finally {
          await Promise.all([factory.close(), page.close()]);
        }
        expect(cleanup.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
          'fulfilled',
        ]);
      }
    }
  });
}
