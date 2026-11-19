import { expect, type Page, test } from '@playwright/test';
import {
  editorLines,
  quickTapBefore,
} from '../../../lib/core/component/LexicalMarkdown/component/core/browser-test/quick-tap';

const LINES = ['Can we move the review', 'Thursday works better for me'];

/** Opens an email draft and writes a two-line body in its real editor. */
async function openEmailBody(page: Page) {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Email John that I will be late');
  const body = page.getByRole('textbox', {
    name: 'Outgoing message',
    exact: true,
  });
  // Wait for the extracted body, so it cannot replace the typed one.
  await expect(body).toHaveText('I’ll be late');
  await body.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(LINES[0]);
  await page.keyboard.press('Enter');
  await page.keyboard.type(LINES[1]);
  await expect.poll(() => editorLines(body)).toEqual(LINES);
  return body;
}

// The body (`MarkdownTextarea`, which the email compose body and the event
// description share) re-focused itself on every click. That wrote Lexical's
// previous selection back over the caret the browser had just placed, so a
// quick tap left the caret where it was and typing landed at the end.
test('a quick tap moves the caret in an email draft body', async ({ page }) => {
  const body = await openEmailBody(page);
  await quickTapBefore(body, 0, 4);
  await page.keyboard.type('A');
  await quickTapBefore(body, 1, 9);
  await page.keyboard.type('B');
  await quickTapBefore(body, 0, 0);
  await page.keyboard.type('C');
  await expect(body).toBeFocused();
  expect(await editorLines(body)).toEqual([
    'CCan Awe move the review',
    'Thursday Bworks better for me',
  ]);
});
