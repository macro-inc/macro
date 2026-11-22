import { expect, test } from '@playwright/test';

for (const engine of ['native', 'source'] as const) {
  for (const fail of [false, true]) {
    test(`${engine} slash Database ${fail ? 'failure' : 'insertion'} follows its placeholder`, async ({
      page,
    }, testInfo) => {
      console.log(
        'Browser scope: real editor/menu/Await, held create response, recording card preview, trackMention disabled.'
      );
      const errors: string[] = [];
      const binaries: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (request.url().endsWith('.wasm')) binaries.push(request.url());
      });
      await page.route('**/*', async (route) => {
        if (!route.request().url().startsWith('http://127.0.0.1:43829/')) {
          await route.abort();
          return;
        }
        const response = await route.fetch();
        await route.fulfill({ response });
      });
      await page.goto(
        `${engine === 'source' ? '/source.html' : '/'}${fail ? '?fail' : ''}`
      );
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      await page.getByRole('textbox', { name: 'Document body' }).click();
      await page.keyboard.type('/database');
      const action = page.getByText('Database', { exact: true });
      await expect(action).toBeVisible();
      await action.click();
      await expect(page.locator('#service')).toHaveText(
        JSON.stringify({ name: 'Untitled database', source: 'slash-menu' })
      );
      await expect(
        page.getByText('Creating database…', { exact: true })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Complete database' }).click();
      if (fail) {
        await expect(
          page.getByText('Your database could not be created. Try again.', {
            exact: true,
          })
        ).toBeVisible();
        await expect(page.locator('[data-await-id]')).toHaveCount(0);
        await expect(page.locator('[data-fixture-database-card]')).toHaveCount(
          0
        );
      } else {
        await expect(page.locator('#model')).toContainText('document-card');
        await expect(page.locator('[data-fixture-database-card]')).toHaveText(
          'Untitled database'
        );
        const state = JSON.parse(await page.locator('#model').innerText());
        expect(
          state.root.children.map((node: { type: string }) => node.type)
        ).toEqual(['document-card', 'paragraph']);
        expect(JSON.stringify(state)).toContain('fixture-database');
        expect(JSON.stringify(state)).not.toContain('"await"');
        await testInfo.attach('model', {
          body: JSON.stringify(state),
          contentType: 'application/json',
        });
      }
      if (engine === 'source') expect(binaries).toEqual([]);
      expect(errors).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath('database-action.png'),
      });
    });
  }
}

for (const engine of ['native', 'source'] as const) {
  for (const access of ['edit', 'read', 'comment']) {
    test(`${engine} newer document ${access} stays readable and copyable under Source warning`, async ({
      page,
      context,
    }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.route('**/*', async (route) => {
        if (!route.request().url().startsWith('http://127.0.0.1:43829/'))
          return route.abort();
        await route.fulfill({ response: await route.fetch() });
      });
      await page.goto(
        `/${engine === 'source' ? 'version-source' : 'version'}.html?access=${access}`
      );
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      const body = page.getByRole('textbox', { name: 'Document body' });
      await expect(
        page.getByText(
          'Refresh the page to edit this document. It may have been updated using a newer version of Macro.',
          { exact: true }
        )
      ).toBeVisible();
      await expect(body).toHaveAttribute('contenteditable', 'false');
      // Source's ordinary read-only content div has no aria-readonly override.
      expect(await body.getAttribute('aria-readonly')).toBeNull();
      await expect(body).toHaveText('Before');
      await body.click();
      await page.keyboard.type('After');
      await expect(body).toHaveText('Before');
      await body.evaluate(async (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && text.textContent !== 'Before') text = walker.nextNode();
        if (!text) throw new Error('Missing readable text');
        const range = document.createRange();
        range.selectNodeContents(text);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      });
      const sentinel = `unselected-${engine}-${access}`;
      await page.evaluate(
        (text) => navigator.clipboard.writeText(text),
        sentinel
      );
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        sentinel
      );
      await page.keyboard.press('Control+c');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'Before'
      );
      expect(errors).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath('version-warning.png'),
      });
    });
  }
}
