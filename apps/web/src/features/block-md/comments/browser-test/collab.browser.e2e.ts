import { expect, test } from '@playwright/test';

for (const readonly of [false, true]) {
  for (const mode of ['acked', 'rejected', 'catchup']) {
    const reject = mode === 'rejected';
    const catchup = mode === 'catchup';
    test(`repeated comments preserve collaborative text (${readonly ? 'commenter' : 'editor'}, ${mode})`, async ({
      page,
    }) => {
      await page.route('**/*', (route) =>
        new URL(route.request().url()).hostname === 'localhost'
          ? route.continue()
          : route.abort()
      );
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.goto(
        `/src/features/block-md/comments/browser-test/collab.html?${readonly ? 'readonly&' : ''}${reject ? 'reject' : ''}${catchup ? 'missed-update' : ''}`
      );
      await page.waitForFunction(() => window.commentCollab?.ready());
      const editor = page.getByRole('textbox', { name: 'Document' });
      const original = await editor.locator('p').first().innerText();
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = await page.evaluate(() =>
          window.commentCollab!.version()
        );
        const selectionRect = await editor.evaluate((element) => {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = node.textContent?.indexOf('shared') ?? -1;
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + 6);
            const rect = range.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              y: rect.top + rect.height / 2,
            };
          }
          throw new Error('Missing selected word');
        });
        await page.mouse.move(selectionRect.left, selectionRect.y);
        await page.mouse.down();
        await page.mouse.move(selectionRect.right, selectionRect.y, {
          steps: 6,
        });
        await page.mouse.up();
        await expect
          .poll(() => page.evaluate(() => window.getSelection()?.toString()))
          .toBe('shared');
        await page
          .getByRole('button', { name: 'Comment', exact: true })
          .click();
        await expect(page.getByTestId('draft')).not.toBeEmpty();
        expect(await page.evaluate(() => window.commentCollab!.version())).toBe(
          version
        );
        await page.evaluate(() => window.commentCollab!.remoteEdit());
        const visibleEdits = catchup ? attempt * 2 : attempt + 1;
        await expect(page.getByTestId('draft')).not.toBeEmpty();
        await expect
          .poll(() => editor.locator('p').first().innerText())
          .toBe(original.replace('notes', 'notes' + '!'.repeat(visibleEdits)));
        await page
          .getByRole('button', { name: 'Post comment', exact: true })
          .click();
        await expect(page.getByTestId('result')).toHaveText(
          reject ? 'rejected' : 'accepted'
        );
        if (reject) {
          await expect(page.getByTestId('draft')).not.toBeEmpty();
          await page.getByRole('button', { name: 'Cancel draft' }).click();
        }
        await expect(page.getByTestId('draft')).toBeEmpty();
        await expect
          .poll(() => editor.locator('p').first().innerText())
          .toBe(
            original.replace(
              'notes',
              'notes' + '!'.repeat((attempt + 1) * (catchup ? 2 : 1))
            )
          );
      }
    });
  }
}
