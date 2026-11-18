import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/equation-browser-test/fixture.html';
test.beforeAll(async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Missing server');
  const page = await browser.newPage();
  await page.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  try {
    await page.goto(new URL(`${path}?engine=factory`, baseURL).href);
    await expect(
      page.locator('[aria-label="Equation proof"] .katex')
    ).toHaveCount(2);
  } finally {
    try {
      await page.evaluate(() => window.equationProofClose?.());
    } finally {
      await page.close();
    }
  }
});
test('actual native equation render and edits match the imported Source trace', async ({
  context,
}, info) => {
  await context.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  const pages = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  const [factory, source, native] = pages;
  if (!factory || !source || !native) throw new Error('Missing actual pages');
  const proofs = pages.map(watchCompiledSourceDeps);
  const errors: string[] = [];
  pages.forEach((page) =>
    page.on('pageerror', (error) => errors.push(error.message))
  );
  const capture = async (page: Page) =>
    page.evaluate(() => {
      if (!window.equationProofFixture)
        throw new Error('Missing actual equation surface');
      return window.equationProofFixture.snapshot();
    });
  const records = [];
  let cleanupResults: PromiseSettledResult<void>[] = [];
  try {
    await factory.goto(`${path}?engine=factory`);
    await expect(
      factory.locator('[aria-label="Equation proof"] .katex')
    ).toHaveCount(2);
    const input = (await capture(factory)).model;
    for (const [engine, page] of [
      ['lexical', source],
      ['native', native],
    ] as const) {
      await page.addInitScript((model) => {
        window.equationProofInput = model;
      }, input);
      await page.bringToFront();
      await page.goto(`${path}?engine=${engine}`);
      const root = page.locator('[aria-label="Equation proof"]');
      await expect(root.locator('.katex')).toHaveCount(2);
      const snapshots = [await capture(page)];
      for (const [index, equation, text] of [
        [0, 'y^3-2', 'y'],
        [1, '\\int_0^1 x dx', '∫'],
        [0, 'z^4+3', 'z'],
      ] as const) {
        if (equation === 'z^4+3') {
          await page.evaluate(() =>
            window.equationProofFixture?.setCanEdit(false)
          );
        }
        await root
          .locator('.md-editor-equation')
          .nth(index)
          .getByRole('button')
          .dblclick();
        const field = page.getByPlaceholder('Enter LaTeX expression');
        await expect(field).toBeVisible();
        await field.fill(equation);
        await expect(
          page.getByRole('button', { name: 'Insert', exact: true })
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Update', exact: true }).click();
        await expect(field).toHaveCount(0);
        await expect(root.locator('.katex').nth(index)).toContainText(text);
        snapshots.push(await capture(page));
      }
      records.push({ engine, snapshots });
    }
    for (let i = 0; i < 4; i++)
      expect.soft(records[1]?.snapshots[i]).toEqual(records[0]?.snapshots[i]);
    expect(errors).toEqual([]);
  } finally {
    try {
      await info.attach('native-equation.json', {
        body: JSON.stringify({
          records,
          errors,
          compiledProofs: await Promise.all(proofs.map((finish) => finish())),
        }),
        contentType: 'application/json',
      });
    } finally {
      cleanupResults = await Promise.allSettled(
        pages.map(async (page) => {
          try {
            await page.evaluate(async () => {
              await window.equationProofClose?.();
            });
          } finally {
            await page.close();
          }
        })
      );
    }
  }
  expect(cleanupResults.every((result) => result.status === 'fulfilled')).toBe(
    true
  );
});
