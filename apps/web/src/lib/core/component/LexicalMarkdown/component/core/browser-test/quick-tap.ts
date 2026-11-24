import type { Locator, Page } from '@playwright/test';

/**
 * Taps `point` with the press and the release sent together, without waiting
 * for the page to handle the press, as a trackpad tap-to-click or a quick
 * touch tap arrives. The click then reaches the page before the
 * selectionchange the press caused, which is also what a busy main thread
 * does to an ordinary click. Touch pages get a touch tap, others a mouse click.
 */
export async function quickTap(page: Page, point: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) {
    await Promise.all([
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      }),
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }),
    ]);
  } else {
    const event = { ...point, button: 'left' as const, clickCount: 1 };
    await page.mouse.move(point.x, point.y);
    await Promise.all([
      cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...event }),
      cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...event }),
    ]);
  }
  await cdp.detach();
  await page.waitForTimeout(100);
}

/** The paragraphs of the Lexical root `editor`, as text. */
export function editorLines(editor: Locator) {
  return editor.evaluate((element) =>
    Array.from(
      element.querySelectorAll(':scope > p'),
      (paragraph) => paragraph.textContent ?? ''
    )
  );
}

/**
 * Taps inside character `offset` of paragraph `line` of the Lexical root
 * `editor`, so the caret lands before that character.
 */
export async function quickTapBefore(
  editor: Locator,
  line: number,
  offset: number
) {
  const point = await editor.evaluate(
    (element, { line, offset }) => {
      const text = element
        .querySelectorAll(':scope > p')
        [line]?.querySelector('span')?.firstChild;
      if (!text) throw new Error('draft text missing');
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 4, y: rect.top + rect.height / 2 };
    },
    { line, offset }
  );
  await quickTap(editor.page(), point);
}
