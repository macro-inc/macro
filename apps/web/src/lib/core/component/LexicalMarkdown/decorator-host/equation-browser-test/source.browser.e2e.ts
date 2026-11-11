import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/equation-browser-test/fixture.html';
test.beforeAll(async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Missing fixture server');
  const page = await browser.newPage();
  page.on('pageerror', (error) =>
    console.error('Source warm error:', error.stack)
  );
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
test('actual Source renders and edits inline and block equations', async ({
  page,
}, info) => {
  await page.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  const finish = watchCompiledSourceDeps(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const captures = [];
  try {
    await page.goto(`${path}?engine=factory`);
    const root = page.locator('[aria-label="Equation proof"]');
    await expect(root.locator('.katex')).toHaveCount(2);
    captures.push(
      await page.evaluate(() => {
        if (!window.equationProofFixture) throw new Error('Missing Source');
        return window.equationProofFixture.snapshot();
      })
    );
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
      const input = page.getByPlaceholder('Enter LaTeX expression');
      await expect(input).toBeVisible();
      await input.fill(equation);
      await page.getByRole('button', { name: 'Update', exact: true }).click();
      await expect(input).toHaveCount(0);
      await expect(root.locator('.katex').nth(index)).toContainText(text);
      captures.push(
        await page.evaluate(() => {
          if (!window.equationProofFixture) throw new Error('Missing Source');
          return window.equationProofFixture.snapshot();
        })
      );
    }
    expect(errors).toEqual([]);
  } finally {
    try {
      await info.attach('source-equation.json', {
        body: JSON.stringify({
          captures,
          errors,
          compiledProof: await finish(),
        }),
        contentType: 'application/json',
      });
    } finally {
      await page.evaluate(async () => {
        await window.equationProofClose?.();
      });
    }
  }
});
