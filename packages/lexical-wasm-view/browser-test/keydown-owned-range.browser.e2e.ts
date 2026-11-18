import { expect, test } from '@playwright/test';
import type {} from './heading-enter-fixture';

for (const feedback of ['pending', 'delivered'] as const) {
  test(`native Enter and rich paste use ${feedback} browser selection feedback`, async ({
    page,
  }, info) => {
    await page.goto('/browser-test/heading-enter.html');
    await page.waitForFunction(() => Boolean(window.inputParity));
    await page.evaluate(() => window.inputParity.prepareHistory());
    const root = page.locator('#native');
    await root.click();
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('abc');
    await expect(root.locator('code')).toHaveText('abc');
    await page.keyboard.press('Control+z');
    await expect(root.locator('code')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(root.locator('code')).toHaveText('abc');
    const redone = await page.evaluate(() =>
      window.inputParity.snapshot('native')
    );
    expect(
      redone.json.root.children.map((node: { type: string }) => node.type)
    ).toEqual(['custom-code', 'paragraph']);
    expect(redone.selection?.anchor).toEqual({
      path: [0, 0],
      offset: 0,
      type: 'text',
    });

    await root.evaluate((element, pending) => {
      const paragraph = element.querySelector(':scope > p');
      const selection = element.ownerDocument.getSelection();
      if (!paragraph || !selection)
        throw new Error('Missing live trailing caret');
      selection.setBaseAndExtent(paragraph, 0, paragraph, 0);
      if (!pending) return;
      // Keep these events in the same task as the real DOM movement so the
      // browser cannot deliver selectionchange until after Enter.
      for (const key of ['Control', 'End', 'Enter']) {
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            ctrlKey: key !== 'Enter',
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }, feedback === 'pending');
    if (feedback === 'delivered') {
      await page.waitForFunction(() => {
        const point = window.inputParity.snapshot('native').selection?.anchor;
        return point?.path.join('/') === '1' && point.offset === 0;
      });
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
    }
    const entered = await page.evaluate(() =>
      window.inputParity.snapshot('native')
    );
    expect(entered.json.root.children).toHaveLength(
      feedback === 'pending' ? 2 : 3
    );
    expect(
      entered.json.root.children[0].children.some(
        (node: { type: string }) => node.type === 'linebreak'
      )
    ).toBe(feedback === 'pending');

    const pasteEvent = await root.evaluate((element) => {
      const data = new DataTransfer();
      const mime = 'application/x-lexical-editor';
      const payload = JSON.stringify({
        namespace: 'block-md-main',
        nodes: ['alpha', 'beta'].map((text) => ({
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text }],
        })),
      });
      data.setData(mime, payload);
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      // Gecko's synthetic constructor filters custom MIME entries from its
      // event copy. Keep the original browser DataTransfer for this fixture.
      if (event.clipboardData?.getData(mime) !== payload)
        Object.defineProperty(event, 'clipboardData', { value: data });
      element.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        transfersRich: event.clipboardData?.getData(mime) === payload,
      };
    });
    await info.attach('paste-admission', {
      body: JSON.stringify({ entered, pasteEvent }, null, 2),
      contentType: 'application/json',
    });
    expect(pasteEvent).toEqual({ prevented: true, transfersRich: true });
    await expect(root).toContainText('beta');
    const pasted = await page.evaluate(() =>
      window.inputParity.snapshot('native')
    );
    if (feedback === 'pending') {
      expect(pasted.json.root.children).toHaveLength(2);
      expect(
        pasted.json.root.children[0].children.every(
          (node: { type: string }) =>
            node.type === 'text' ||
            node.type === 'linebreak' ||
            node.type === 'tab'
        )
      ).toBe(true);
      await expect(root.locator('code')).toContainText('alpha');
      await expect(root.locator('code')).toContainText('beta');
    } else {
      await expect(root.locator('code')).toHaveText('abc');
      await expect(root.locator(':scope > p')).toContainText(['alpha', 'beta']);
    }
    expect(await page.evaluate(() => window.inputParity.errors)).toEqual([]);
    await info.attach('owned-range-phases', {
      body: JSON.stringify({ redone, entered, pasted }, null, 2),
      contentType: 'application/json',
    });
  });
}
