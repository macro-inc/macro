import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/browser-test/fixture.html';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="#456789"/></svg>';

for (const backend of ['OFF']) {
  test(`actual ${backend} decorator DOM and mention/image/equation interactions`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.stack);
    });
    await page.route('**/__macro_dev/gateway/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/email/links')) {
        return route.fulfill({ json: { links: [] } });
      }
      return route.abort();
    });
    await page.route('**/file/decorator-fixture.svg', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: {
          'access-control-allow-origin': new URL(page.url()).origin,
          'access-control-allow-credentials': 'true',
        },
        body: image,
      })
    );
    await page.goto(backend === 'ON' ? `${fixture}?engine=native` : fixture);
    const root = page.getByRole('textbox', { name: 'Decorator fixture' });
    await expect(root.locator('[data-user-mention="true"]')).toBeVisible();
    await expect(root.locator('[data-user-mention="true"]')).toHaveText(
      '@Fixture User'
    );
    await expect(root.locator('[data-user-mention="true"]')).toHaveAttribute(
      'data-email',
      'user@example.com'
    );
    await expect(root.locator('.katex')).toBeVisible();
    const media = root.getByRole('img');
    await expect(media).toBeVisible();
    await expect
      .poll(() =>
        media.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth
        )
      )
      .toBe(256);
    const before = await page.evaluate(() =>
      window.decoratorFixture?.snapshot()
    );
    await testInfo.attach('before.json', {
      body: JSON.stringify(before),
      contentType: 'application/json',
    });
    await testInfo.attach('before-dom.html', {
      body: await root.innerHTML(),
      contentType: 'text/html',
    });
    await root.locator('[data-user-mention="true"]').hover();
    await expect(
      page.getByRole('button', { name: 'Copy email', exact: true })
    ).toBeVisible();
    await page.mouse.move(950, 750);
    await expect(
      page.getByRole('button', { name: 'Copy email', exact: true })
    ).toBeHidden();
    await media.click();
    await testInfo.attach('image-selection.json', {
      body: JSON.stringify(
        await page.evaluate(() => window.decoratorFixture?.debug?.() ?? null)
      ),
      contentType: 'application/json',
    });
    await expect(root.locator('.ring-3')).toBeVisible();
    const handle = root.locator('.cursor-col-resize').last();
    await expect(handle).toBeVisible();
    const bounds = await handle.boundingBox();
    if (!bounds) throw new Error('Missing resize handle box');
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 32,
      bounds.y + bounds.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() => window.decoratorFixture?.snapshot().image)
      )
      .toMatchObject({ scale: 1.25 });
    await root.locator('.md-editor-equation [role="button"]').dblclick();
    await expect(
      page.getByText('LaTeX Expression', { exact: true })
    ).toBeVisible();
    await page.getByPlaceholder('Enter LaTeX expression').fill('y^3');
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => window.decoratorFixture?.snapshot().equation)
      )
      .toBe('y^3');
    await expect(
      page.getByText('LaTeX Expression', { exact: true })
    ).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.decoratorFixture?.snapshot()))
      .toMatchObject({
        image: { scale: 1.25 },
        equation: 'y^3',
        inline: false,
      });
    await testInfo.attach('after.json', {
      body: JSON.stringify(
        await page.evaluate(() => window.decoratorFixture?.snapshot())
      ),
      contentType: 'application/json',
    });
    await testInfo.attach('after-dom.html', {
      body: await root.innerHTML(),
      contentType: 'text/html',
    });
    expect(errors).toEqual([]);
  });
}
