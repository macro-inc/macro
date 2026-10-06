import { expect, type Page, test } from '@playwright/test';

// Text editing as in Figma: the caret and selection drawn from the
// engine's layout, styling a range of characters, keyboard and mouse
// selection, undo in typing bursts, and fonts (the fixture stands in for
// Google Fonts and this computer's fonts with the bundled Inter, see
// font-source.ts).

async function openNew(page: Page) {
  await page.goto('/?new&reload');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-tool-rectangle')).toBeVisible();
}

/** Places a text layer and types into it. */
async function typeNewText(page: Page, text: string) {
  await page.getByTestId('fig-canvas').focus();
  await page.keyboard.press('t');
  const box = await page.getByTestId('fig-canvas').boundingBox();
  if (!box) throw new Error('The canvas is not visible.');
  await page.mouse.click(box.x + 120, box.y + 120);
  const editor = page.getByTestId('fig-text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type(text);
  await expect(editor).toHaveValue(text);
}

/** The text editor's selection, `[start, end]`. */
function selection(page: Page) {
  return page.getByTestId('fig-text-editor').evaluate((el) => {
    const area = el as HTMLTextAreaElement;
    return [area.selectionStart, area.selectionEnd];
  });
}

/** The selected layer's text info, from the engine. */
function textInfo(page: Page) {
  return page.evaluate(async () => {
    const engine = window.figFixture.engine();
    const [id] =
      (await engine
        ?.layers(0)
        .then((rows) =>
          rows.filter((r) => r.type === 'TEXT').map((r) => r.id)
        )) ?? [];
    if (!engine || !id) return null;
    return (await engine.nodeInfo(0, id)).text;
  });
}

test('draws the caret and selection from the layout', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'Hello world');
  const caret = page.getByTestId('fig-text-caret');
  await expect(caret).toHaveCount(1);
  await page.keyboard.press('Home');
  await expect.poll(() => selection(page)).toEqual([0, 0]);
  const start = await caret.boundingBox();
  await page.keyboard.press('End');
  await expect.poll(() => selection(page)).toEqual([11, 11]);
  // The caret spans the text's width, as the engine laid it out.
  const textBox = page.getByTestId('fig-text-box');
  await expect
    .poll(async () => {
      const [end, text] = [
        await caret.boundingBox(),
        await textBox.boundingBox(),
      ];
      return end && start && text ? Math.abs(end.x - start.x - text.width) : 99;
    })
    .toBeLessThan(3);
  // Shift extends; the selection shows instead of the caret.
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await expect.poll(() => selection(page)).toEqual([0, 11]);
  await expect(page.getByTestId('fig-text-selection')).toHaveCount(1);
  await expect(caret).toHaveCount(0);
  // A double click selects the word under it.
  const box = await page.getByTestId('fig-text-box').boundingBox();
  if (!box) throw new Error('The text box is not visible.');
  await page.mouse.dblclick(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect.poll(() => selection(page)).toEqual([6, 11]);
  // A triple click, the paragraph.
  await page.mouse.click(box.x + 4, box.y + box.height / 2, { clickCount: 3 });
  await expect.poll(() => selection(page)).toEqual([0, 11]);
});

test('moves between lines with the arrow keys', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect.poll(() => selection(page)).toEqual([12, 12]);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selection(page)).toEqual([5, 5]);
  // Down keeps the x: "first|" sits over "sec|ond".
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => selection(page)).toEqual([5, 9]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await expect.poll(() => selection(page)).toEqual([0, 0]);
});

test('styles a range of characters', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'plain bold');
  // Select "bold" and make it bold, underlined.
  for (let k = 0; k < 4; k++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => selection(page)).toEqual([6, 10]);
  await page.keyboard.press('ControlOrMeta+b');
  await expect
    .poll(async () => (await textInfo(page))?.runs.map((r) => r.fontStyle))
    .toEqual(['Bold']);
  await expect(page.getByTestId('fig-font-weight')).toHaveText('Bold');
  await page.keyboard.press('ControlOrMeta+u');
  await expect
    .poll(async () => (await textInfo(page))?.runs[0]?.decoration)
    .toBe('UNDERLINE');
  const info = await textInfo(page);
  expect(info?.styleIds).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  expect(info?.fontStyle).toBe('Regular');
  // Over both, the Type section shows the weight as mixed.
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('fig-font-weight')).toHaveText('Mixed');
  // A size from the panel applies to the selected characters only.
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => selection(page)).toEqual([0, 2]);
  const size = page.getByTestId('fig-field-font-size');
  await size.fill('30');
  await size.press('Enter');
  await expect
    .poll(async () => (await textInfo(page))?.runs.map((r) => r.fontSize))
    .toContain(30);
  expect((await textInfo(page))?.fontSize).toBe(12);
  // Styles survive saving and reopening.
  await page.getByTestId('fig-text-editor').press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.figFixture.saves().length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('bolds what is typed next at a caret', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'a');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('b');
  await expect
    .poll(async () => (await textInfo(page))?.styleIds)
    .toEqual([0, 1]);
});

test('undoes typing in bursts and keeps editing', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'one');
  await page.waitForTimeout(1200);
  await page.keyboard.type(' two');
  const editor = page.getByTestId('fig-text-editor');
  await expect(editor).toHaveValue('one two');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue('one');
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue('one two');
});

test('switches fonts, loading them first', async ({ page }) => {
  await openNew(page);
  await typeNewText(page, 'Hello');
  await page.keyboard.press('Escape');
  await page.getByTestId('fig-font-family').click();
  await page.getByTestId('fig-font-search').fill('Roboto Mono');
  await page
    .locator('[data-testid="fig-font-option"][data-family="Roboto Mono"]')
    .click();
  await expect(page.getByTestId('fig-font-family')).toHaveAttribute(
    'data-value',
    'Roboto Mono'
  );
  // The panel shows the family as soon as it is picked; its files load after.
  const requested = async (match: (r: string) => boolean) =>
    (await page.evaluate(() => window.figFixture.fontRequests())).some(match);
  await expect
    .poll(() => requested((r) => r.includes('family=Roboto+Mono')))
    .toBe(true);
  await expect
    .poll(() => requested((r) => r.endsWith('InterVariable.ttf')))
    .toBe(true);
  await expect
    .poll(async () => (await textInfo(page))?.fontStatus)
    .toBe('AVAILABLE');
  await expect(page.getByTestId('fig-font-missing')).toHaveCount(0);
});

test('lists missing fonts and uses this computer’s', async ({ page }) => {
  await openNew(page);
  await page.evaluate(async () => {
    const engine = window.figFixture.engine();
    const summary = await engine?.currentSummary();
    const pageId = summary?.pages[0].id ?? '0:1';
    await engine?.apply(0, [
      {
        op: 'create',
        parent: pageId,
        node: {
          type: 'TEXT',
          x: 100,
          y: 100,
          width: 1,
          height: 1,
          props: { characters: 'Brand', fontFamily: 'Nowhere Grotesk' },
        },
      },
    ]);
  });
  // The registry learns of the font after the next edit.
  await typeNewText(page, 'x');
  await page.keyboard.press('Escape');
  const notice = page.getByTestId('fig-missing-fonts');
  await expect(notice).toBeVisible();
  await expect(page.getByTestId('fig-missing-font')).toHaveText([
    'Nowhere Grotesk Regular',
  ]);
  await page.getByTestId('fig-use-local-fonts').click();
  await expect(notice).toBeHidden();
  // The notice hides as soon as the font is found; every worker registers
  // it a moment later.
  await expect
    .poll(async () => {
      const fonts = await page.evaluate(() =>
        window.figFixture.engine()?.fonts()
      );
      return fonts?.find((f) => f.family === 'Nowhere Grotesk')?.status;
    })
    .toBe('AVAILABLE');
});
