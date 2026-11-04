import { expect, test } from '@playwright/test';

for (const readonly of [false, true]) {
  for (const paragraph of [0, 1]) {
    test(`open, cancel and retry on ${paragraph === 0 ? 'commented' : 'plain'} text (${readonly ? 'commenter' : 'editor'})`, async ({
      page,
    }, testInfo) => {
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).hostname === 'localhost')
          await route.continue();
        else await route.abort();
      });
      await page.routeWebSocket('**/*', (socket) => socket.close());
      await page.goto(
        `/src/features/block-md/comments/browser-test/drafts.html${readonly ? '?readonly' : ''}`
      );
      const editor = page.getByRole('textbox', { name: 'Document' });
      await expect(editor).toContainText('Already commented text');
      for (let attempt = 0; attempt < 2; attempt++) {
        await editor.evaluate((element, paragraph) => {
          element.focus();
          const text = element
            .querySelectorAll('p')
            [paragraph].querySelector('[data-lexical-text]')?.firstChild;
          if (!text) throw new Error('Missing selected text');
          const range = document.createRange();
          range.setStart(text, 2);
          range.setEnd(text, Math.min(7, text.textContent?.length ?? 0));
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }, paragraph);
        const button = page.getByRole('button', {
          name: 'Comment',
          exact: true,
        });
        await expect(button).toBeEnabled();
        const rect = await button.boundingBox();
        if (!rect) throw new Error('Comment button missing');
        if (testInfo.project.use.hasTouch) {
          await button.tap();
        } else {
          await page.mouse.move(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          );
          await page.mouse.down();
          if (!readonly) await expect(editor).toBeFocused();
          await page.mouse.up();
        }
        await expect(page.getByTestId('result')).toHaveText('true');
        await expect(page.getByTestId('draft')).not.toBeEmpty();
        await expect(editor.locator('mark.draft')).toHaveCount(1);
        await expect(editor.locator('p').nth(0)).toHaveText(
          'Already commented text'
        );
        await expect(editor.locator('p').nth(1)).toHaveText(
          'Plain text for another comment'
        );
        const draftId = await page.getByTestId('draft').textContent();
        await expect(page.getByTestId('saved')).not.toContainText(draftId!);
        await expect(page.getByTestId('saved')).toContainText('saved-comment');
        if (attempt === 0)
          await page.screenshot({
            path: testInfo.outputPath('comment-draft.png'),
          });
        await page.getByRole('button', { name: 'Cancel draft' }).click();
        await expect(editor.locator('mark.draft')).toHaveCount(0);
        await expect(editor.locator('mark')).toHaveCount(1);
        await expect(editor).toContainText('Already commented text');
      }
    });
  }
}
