import { expect, type Page, test } from '@playwright/test';

const FIXTURE =
  '/src/features/email-compose/browser-test/recipient-hotkeys.html';

/** Taller than the reply box's height cap, so the box has to scroll. */
const LONG_REPLY = [
  '<p>Thanks for the notes from Tuesday. Here is where the rollout stands.</p>',
  '<ul>',
  '<li><b>Accounts:</b> one record per workspace, keyed by its own identifier, renamed whenever the workspace is.</li>',
  '<li><b>Schedules:</b> start and end times, the time zone, and whether a break is included.</li>',
  '<li><b>Reports:</b> a weekly export in the existing spreadsheet layout until the live sync is ready.</li>',
  '</ul>',
  ...Array.from(
    { length: 8 },
    (_, index) =>
      `<p>Paragraph ${index + 1}: the import creates or updates each record, prepares the weekly summary, and sends a short confirmation once the run finishes, so nobody has to check the dashboard by hand.</p>`
  ),
].join('');

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
});

async function pasteHtml(page: Page, html: string) {
  await page.locator('[contenteditable="true"]').evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', html.replace(/<[^>]+>/g, ' '));
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, html);
}

/** Pixels between the reply's last line and the watermark; negative overlaps. */
async function gapBelowReply(page: Page) {
  return page.evaluate(() => {
    const editable = document.querySelector('[contenteditable="true"]');
    const watermark = document.querySelector('[data-watermark]');
    if (!editable || !watermark) throw new Error('composer not mounted');
    return (
      watermark.getBoundingClientRect().top -
      editable.getBoundingClientRect().bottom
    );
  });
}

async function expectWatermarkAfterReply(page: Page) {
  await expect(page.locator('[data-watermark]')).toHaveText(
    '-- Sent with Macro'
  );
  await expect.poll(() => gapBelowReply(page)).toBeGreaterThanOrEqual(0);
}

for (const composer of ['reply', 'forward']) {
  test(`the watermark stays below a long ${composer}`, async ({ page }) => {
    await page.goto(`${FIXTURE}?composer=${composer}&free`);
    const editable = page.locator('[contenteditable="true"]');
    await editable.click();
    await pasteHtml(page, LONG_REPLY);
    await expect(editable.locator('li')).toHaveCount(3);
    await expectWatermarkAfterReply(page);

    // Keep writing at the end, as the box grows and expands on scroll.
    await page.keyboard.press('ControlOrMeta+End');
    for (const line of ['One more thing.', 'Talk soon.']) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line);
    }
    await expect(editable).toContainText('Talk soon.');
    await expectWatermarkAfterReply(page);

    // At the end of the scrolled box, the watermark ends the message.
    const watermark = page.locator('[data-watermark]');
    await watermark.evaluate((element) => {
      let scroller = element.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
        scroller = scroller.parentElement;
      }
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });
    await expect(watermark).toBeInViewport();
    await expectWatermarkAfterReply(page);
  });
}
