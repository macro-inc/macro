import { expect, type Page, test } from '@playwright/test';

async function snapshot(page: Page) {
  return page.evaluate(() => window.compatSnapshot());
}
const granularities: ('word' | 'lineboundary')[] = ['word', 'lineboundary'];
for (const granularity of granularities) {
  test(`selection ${granularity} matches original browser movement`, async ({
    page,
  }) => {
    await page.goto('http://127.0.0.1:41872');
    await page.addStyleTag({
      content: '#editor { width: 120px; white-space: pre-wrap; }',
    });
    await page.locator('#editor').click();
    await page.keyboard.type(
      'alpha 😀 café combining é and wrapped words finish'
    );
    const result = await page.evaluate(
      (granularity) => window.compatModifySelection(granularity),
      granularity
    );
    expect(result).toMatchObject({
      equal: true,
      moved: true,
      dirtyMatches: true,
    });
  });
}
for (const [name, text] of [
  ['heading and Enter', '# title\n'],
  ['punctuation caret', 'b;'],
]) {
  test(name, async ({ browser }) => {
    const upstream = await browser.newPage();
    const port = await browser.newPage();
    await upstream.goto('http://127.0.0.1:41871');
    await port.goto('http://127.0.0.1:41872');
    await upstream.locator('#editor').click();
    await port.locator('#editor').click();
    for (const char of text) {
      for (const page of [upstream, port]) {
        if (char === '\n') await page.keyboard.press('Enter');
        else await page.keyboard.type(char);
      }
      expect(await snapshot(port), `after ${JSON.stringify(char)}`).toEqual(
        await snapshot(upstream)
      );
    }
    if (name === 'heading and Enter') {
      await expect(port.locator('#editor > h1')).toHaveText('title');
      await expect(port.locator('#editor > p')).toHaveCount(1);
    } else {
      await expect(port.locator('#editor')).toHaveText('b;');
      expect(
        await port.evaluate(() => window.getSelection()?.anchorOffset)
      ).toBe(2);
    }
    await upstream.close();
    await port.close();
  });
}
test('large HTML paste', async ({ browser }) => {
  const upstream = await browser.newPage();
  const port = await browser.newPage();
  await upstream.goto('http://127.0.0.1:41871');
  await port.goto('http://127.0.0.1:41872');
  const html =
    '<h1>Chapter</h1>' +
    Array.from(
      { length: 500 },
      (_, i) =>
        `<p>Paragraph ${i}: <strong>formatted</strong> text and punctuation; repeated content.</p>`
    ).join('');
  for (const page of [upstream, port]) {
    await page.locator('#editor').click();
    await page.evaluate((html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData(
        'text/plain',
        'Chapter\n' +
          Array.from(
            { length: 500 },
            (_, i) =>
              `Paragraph ${i}: formatted text and punctuation; repeated content.`
          ).join('\n')
      );
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
      });
      // Firefox ignores ClipboardEventInit.clipboardData for synthetic events.
      // Supply the same real DataTransfer payload to every browser's handler.
      Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector('#editor')?.dispatchEvent(event);
    }, html);
  }
  expect(await snapshot(port)).toEqual(await snapshot(upstream));
  await expect(port.locator('#editor > p')).toHaveCount(500);
  await expect(port.locator('#editor > h1')).toHaveText('Chapter');
  await upstream.close();
  await port.close();
});
