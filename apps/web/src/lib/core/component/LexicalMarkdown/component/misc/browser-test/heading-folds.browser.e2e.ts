import { expect, type Locator, type Page, test } from '@playwright/test';

const FIXTURE =
  '/src/lib/core/component/LexicalMarkdown/component/misc/browser-test/heading-folds.html';

async function open(page: Page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.goto(FIXTURE);
  const editor = page.getByRole('textbox', { name: 'Document content' });
  await expect(editor).toBeVisible({ timeout: 60_000 });
  return editor;
}

const block = (editor: Locator, text: string) =>
  editor.locator(':scope > *', { hasText: text });

const control = (page: Page, name: 'Collapse section' | 'Expand section') =>
  page.getByRole('button', { name });

/** The visible control sitting on a heading's first line. */
async function controlFor(page: Page, heading: Locator) {
  const box = await heading.boundingBox();
  if (!box) throw new Error('heading not laid out');
  const buttons = page.locator('button[aria-expanded]');
  for (const button of await buttons.all()) {
    const b = await button.boundingBox();
    if (b && b.y < box.y + 24 && b.y + b.height > box.y) return button;
  }
  throw new Error('no fold control on this heading');
}

test.describe('heading folds', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('fixture-started')) {
        localStorage.clear();
        sessionStorage.setItem('fixture-started', '1');
      }
    });
  });

  test('folds, nests, and survives a reload', async ({ page, hasTouch }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const editor = await open(page);
    const goals = block(editor, 'Goals');
    const risks = block(editor, 'Risks');

    // Only headings with content under them offer a control.
    await expect(page.locator('button[aria-expanded]')).toHaveCount(5);

    const goalsControl = await controlFor(page, goals);
    const [glyphBox, controlBox, rootBox] = [
      await goalsControl.locator('svg').boundingBox(),
      await goalsControl.boundingBox(),
      await editor.boundingBox(),
    ];
    // The chevron sits in the gutter, left of the text, and on screen.
    expect(glyphBox!.x + glyphBox!.width).toBeLessThanOrEqual(rootBox!.x);
    expect(glyphBox!.x).toBeGreaterThanOrEqual(0);
    if (hasTouch) {
      // A full touch target, reaching at most 6px over the text.
      expect(controlBox!.width).toBeGreaterThanOrEqual(36);
      expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(
        rootBox!.x + 6.5
      );
    } else {
      expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(rootBox!.x);
    }

    if (hasTouch) {
      await expect(goalsControl).toHaveCSS('opacity', '1');
    } else {
      await expect(goalsControl).toHaveCSS('opacity', '0');
      await goals.hover();
      await expect(goalsControl).toHaveCSS('opacity', '1');
    }

    // Fold the inner section, then the outer one around it.
    await (await controlFor(page, risks)).click();
    await expect(block(editor, 'Readers lose their place')).toBeHidden();
    await goalsControl.click();
    await expect(risks).toBeHidden();
    await expect(block(editor, 'Ship collapsible')).toBeHidden();
    await expect(block(editor, 'Timeline')).toBeVisible();
    await expect(goalsControl).toHaveAttribute('aria-expanded', 'false');

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await expect(risks).toBeHidden();
    await expect(block(editor, 'Timeline')).toBeVisible();

    // Unfolding the outer section keeps the inner one folded.
    await (await controlFor(page, goals)).click();
    await expect(risks).toBeVisible();
    await expect(block(editor, 'Ship collapsible')).toBeVisible();
    await expect(block(editor, 'Readers lose their place')).toBeHidden();
    await (await controlFor(page, risks)).click();
    await expect(block(editor, 'Readers lose their place')).toBeVisible();
    await expect(control(page, 'Expand section')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('Mod+Enter toggles the heading under the caret', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'a keyboard shortcut');
    const editor = await open(page);
    const timeline = block(editor, 'Timeline');
    await timeline.click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(block(editor, 'Two weeks of building')).toBeHidden();
    await expect(editor).toBeFocused();
    // The heading itself is untouched: no newline was inserted.
    await expect(editor.locator(':scope > *')).toHaveCount(10);

    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(block(editor, 'Two weeks of building')).toBeVisible();
  });

  test('Enter after a folded heading unfolds its section', async ({ page }) => {
    const editor = await open(page);
    const appendix = block(editor, 'Appendix');
    await (await controlFor(page, appendix)).click();
    await expect(block(editor, 'Sources and notes')).toBeHidden();

    await appendix.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(block(editor, 'Sources and notes')).toBeVisible();
  });
});
