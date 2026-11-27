import { type Browser, expect, type Page, test } from '@playwright/test';

// Each case types or resizes step by step and checks the layout after each one.
test.describe.configure({ timeout: 300_000 });

const DEVICES = [
  {
    name: 'desktop',
    viewport: { width: 1280, height: 900 },
    touch: false,
    hostWidth: 520,
  },
  {
    name: 'tablet',
    viewport: { width: 1024, height: 1366 },
    touch: true,
    hostWidth: 600,
  },
  {
    name: 'phone',
    viewport: { width: 390, height: 844 },
    touch: true,
    hostWidth: 358,
  },
] as const;

type Device = (typeof DEVICES)[number];

const DRAFT =
  'Lunch moved to the corner place on Friday, so bring the slides and the budget notes along too';

async function openFixture(browser: Browser, device: Device) {
  const context = await browser.newContext({
    viewport: device.viewport,
    isMobile: device.touch,
    hasTouch: device.touch,
  });
  const page = await context.newPage();
  // The composer runs over synthetic props; no hosted data is read or written.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    )
      await route.continue();
    else
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  // Count copies of the composer and layout reads the page makes, outside
  // the reference measurement below.
  await page.addInitScript(() => {
    const counts = { clones: 0 };
    Reflect.set(window, '__composerCounts', counts);
    const clone = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function (this: Node, deep?: boolean) {
      if (
        !Reflect.get(window, '__referenceMeasure') &&
        this instanceof Element &&
        this.matches('[data-input-layout]')
      )
        counts.clones++;
      return clone.call(this, deep);
    };
  });
  await page.goto('/src/features/channel/Input/browser-test/layout.html');
  await expect(page.locator('[data-markdown-editable]')).toBeVisible({
    timeout: 60_000,
  });
  await setHostWidth(page, device.hostWidth);
  return { context, page };
}

async function setHostWidth(page: Page, width: number) {
  await page.evaluate(async (px) => {
    const host = document.querySelector<HTMLElement>('[data-composer-host]');
    if (!host) throw new Error('No composer host');
    host.style.width = `${px}px`;
    // Resizes settle in the frame after the observer reports them.
    for (let i = 0; i < 3; i++)
      await new Promise((resolve) => requestAnimationFrame(resolve));
  }, width);
}

/**
 * Whether the composer shows the layout its draft needs: the one-line layout
 * exactly when the draft is one paragraph that fits on the one-line layout's
 * line. The reference lays out a copy of the composer in its one-line layout,
 * as the composer itself did before it learned to read its own lines.
 */
function layoutState() {
  const layout = document.querySelector<HTMLElement>('[data-input-layout]');
  const editor = layout?.querySelector<HTMLElement>(
    '[data-lexical-editor="true"]'
  );
  if (!layout?.parentElement || !editor) throw new Error('Composer missing');
  const compact = layout.dataset.composerCompact === 'true';
  const empty = (editor.textContent ?? '') === '';
  const severalBlocks =
    editor.children.length > 1 || editor.firstElementChild?.tagName !== 'P';
  Reflect.set(window, '__referenceMeasure', true);
  const copy = layout.cloneNode(true) as HTMLElement;
  Reflect.set(window, '__referenceMeasure', false);
  copy.dataset.composerCompact = 'true';
  copy.inert = true;
  Object.assign(copy.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '0',
    boxSizing: 'border-box',
    width: `${layout.getBoundingClientRect().width}px`,
  });
  layout.parentElement.append(copy);
  const copyEditor = copy.querySelector<HTMLElement>(
    '[data-lexical-editor="true"]'
  );
  if (!copyEditor) throw new Error('Copy missing its editor');
  const range = document.createRange();
  range.selectNodeContents(copyEditor);
  const wraps =
    range.getBoundingClientRect().height >
    Number.parseFloat(getComputedStyle(copyEditor).lineHeight) + 1;
  copy.remove();
  return {
    compact,
    expectedCompact: empty || (!severalBlocks && !wraps),
  };
}

async function expectLayoutFitsDraft(page: Page, step: string) {
  const state = await page.evaluate(layoutState);
  expect(state.compact, step).toBe(state.expectedCompact);
}

async function isCompact(page: Page) {
  return (await page.evaluate(layoutState)).compact;
}

/** Types the draft until the one-line layout no longer holds it. */
async function typeUntilExpanded(page: Page, text: string) {
  for (const character of text) {
    await page.keyboard.type(character);
    if (!(await isCompact(page))) return;
  }
  throw new Error('The draft never needed a second line');
}

/** How many lines the live editor's draft takes. */
function editorLines() {
  const editor = document.querySelector<HTMLElement>(
    '[data-input-layout] [data-lexical-editor="true"]'
  );
  if (!editor) throw new Error('Composer missing');
  const range = document.createRange();
  range.selectNodeContents(editor);
  return Math.round(
    range.getBoundingClientRect().height /
      Number.parseFloat(getComputedStyle(editor).lineHeight)
  );
}

/** Waits two frames, after the page has handled the events before it. */
async function nextFrames() {
  for (let i = 0; i < 2; i++)
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function clones(page: Page) {
  return page.evaluate(
    () => (Reflect.get(window, '__composerCounts') as { clones: number }).clones
  );
}

async function paste(page: Page, text: string) {
  await page.locator('[data-markdown-editable]').evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', value);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, text);
}

async function focusEditor(page: Page, device: Device) {
  const editor = page.locator('[data-markdown-editable]');
  if (device.touch) await editor.tap();
  else await editor.click();
  await expect(editor).toBeFocused();
}

for (const device of DEVICES) {
  test(`the one-line layout follows the draft while typing, deleting and pasting on ${device.name}`, async ({
    browser,
  }) => {
    const { context, page } = await openFixture(browser, device);
    try {
      await focusEditor(page, device);
      let crossed = false;
      for (const [index, character] of [...DRAFT].entries()) {
        await page.keyboard.type(character);
        await expectLayoutFitsDraft(page, `typed ${index + 1} characters`);
        crossed ||= !(await page.evaluate(layoutState)).compact;
      }
      // The draft is long enough to need a second line on every device.
      expect(crossed).toBe(true);

      // Trailing spaces at the end of the line, then deleting back past it.
      for (let i = 0; i < 4; i++) {
        await page.keyboard.type(' ');
        await expectLayoutFitsDraft(page, `typed trailing space ${i + 1}`);
      }
      for (let i = 0; i < DRAFT.length; i++) {
        await page.keyboard.press('Backspace');
        await expectLayoutFitsDraft(page, `deleted ${i + 1} characters`);
      }

      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await paste(page, DRAFT);
      await expectLayoutFitsDraft(page, 'pasted a long draft');
      expect((await page.evaluate(layoutState)).compact).toBe(false);
      await page.keyboard.press('ControlOrMeta+A');
      await paste(page, 'Short note');
      await expectLayoutFitsDraft(page, 'pasted over it a short one');
      expect((await page.evaluate(layoutState)).compact).toBe(true);

      // Spaces in a text node of their own (bold, after plain text) at the
      // end of a draft that just fits: they hang past the one-line layout's
      // line, so a character after them expands it and deleting that
      // character must compact it again.
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await typeUntilExpanded(page, DRAFT);
      await page.keyboard.press('Backspace');
      await page.keyboard.press('ControlOrMeta+B');
      await page.keyboard.type('   ');
      await expectLayoutFitsDraft(page, 'bold trailing spaces');
      await page.keyboard.type('x');
      await expectLayoutFitsDraft(page, 'a character after them');
      await page.keyboard.press('Backspace');
      await expectLayoutFitsDraft(page, 'the character deleted again');
    } finally {
      await context.close();
    }
  });

  test(`the one-line layout follows a draft near its edge as the composer resizes on ${device.name}`, async ({
    browser,
  }) => {
    const { context, page } = await openFixture(browser, device);
    try {
      await focusEditor(page, device);
      // Type until the draft just needs a second line, then step back to
      // the last length that fits on one.
      await typeUntilExpanded(page, DRAFT);
      await page.keyboard.press('Backspace');
      await expect.poll(() => isCompact(page)).toBe(true);
      const widths = [];
      for (
        let width = device.hostWidth;
        width >= device.hostWidth - 96;
        width -= 8
      )
        widths.push(width);
      const seen = new Set<boolean>();
      for (const width of [...widths, ...widths.toReversed()]) {
        await setHostWidth(page, width);
        await expectLayoutFitsDraft(page, `composer ${width}px wide`);
        seen.add(await isCompact(page));
      }
      expect(seen.size).toBe(2);
    } finally {
      await context.close();
    }
  });
}

test('each channel mounts its composer in the layout its stored draft needs', async ({
  browser,
}) => {
  const { context, page } = await openFixture(browser, DEVICES[0]);
  try {
    await focusEditor(page, DEVICES[0]);
    await page.keyboard.type(DRAFT);
    await expectLayoutFitsDraft(page, 'long draft in the first channel');
    await page.getByRole('button', { name: 'layout-two' }).click();
    await focusEditor(page, DEVICES[0]);
    await page.keyboard.type('Short note');
    await expectLayoutFitsDraft(page, 'short draft in the second channel');

    for (const [channel, compact] of [
      ['layout-one', false],
      ['layout-two', true],
      ['layout-one', false],
    ] as const) {
      // The first frame after the switch already shows the right layout.
      const firstFrame = await page.evaluate(async (name) => {
        const button = [...document.querySelectorAll('nav button')].find(
          (element) => element.textContent === name
        );
        if (!(button instanceof HTMLButtonElement))
          throw new Error(`No ${name} button`);
        button.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return document.querySelector<HTMLElement>('[data-input-layout]')
          ?.dataset.composerCompact;
      }, channel);
      expect(firstFrame, `first frame of ${channel}`).toBe(String(compact));
      await expectLayoutFitsDraft(page, `switched to ${channel}`);
    }
  } finally {
    await context.close();
  }
});

test('caret moves and one-line edits never copy the composer to measure it', async ({
  browser,
}) => {
  const { context, page } = await openFixture(browser, DEVICES[0]);
  try {
    await focusEditor(page, DEVICES[0]);
    const before = await clones(page);
    await page.keyboard.type('A short draft that stays on one line');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('End');
    // Lexical reads a caret move from the selectionchange that follows it;
    // a Backspace before that deletes the stale selection instead.
    await page.evaluate(nextFrames);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Backspace');
    await expect(page.locator('[data-markdown-editable]')).toHaveText(
      'A short draft that stays o'
    );
    await expectLayoutFitsDraft(page, 'short draft');
    expect(await clones(page)).toBe(before);

    // A draft one expanded line long copies the composer to confirm the
    // switch and to learn the one-line layout's room, then compares each
    // edit that keeps it on one expanded line with that room.
    await typeUntilExpanded(page, ' that grows past the end of its line');
    await expectLayoutFitsDraft(page, 'one expanded line');
    const expanded = await clones(page);
    expect(expanded - before).toBeLessThanOrEqual(2);
    await page.keyboard.type('ok');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    await page.evaluate(nextFrames);
    await page.keyboard.press('Backspace');
    await expectLayoutFitsDraft(page, 'further edits');
    expect(await page.evaluate(editorLines)).toBe(1);
    expect(await clones(page)).toBe(expanded);
  } finally {
    await context.close();
  }
});
