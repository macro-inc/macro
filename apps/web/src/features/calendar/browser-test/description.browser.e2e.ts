import { expect, test } from '@playwright/test';

test('paragraph adjacency stays local to sanitized description previews', async ({
  page,
}) => {
  await page.goto('/src/features/calendar/browser-test/description.html');
  await expect(page.locator('#preview p')).toHaveCount(5);
  expect(
    await page
      .locator('#preview p')
      .evaluateAll((paragraphs) =>
        paragraphs.map((p) => getComputedStyle(p).marginTop)
      )
  ).toEqual(['0px', '4px', '0px', '4px', '0px']);
  expect(
    await page
      .locator('#editor p')
      .evaluateAll((paragraphs) =>
        paragraphs.map((p) => getComputedStyle(p).marginTop)
      )
  ).toEqual(['0px', '0px']);
  const selectors = await page.evaluate(() => {
    const selectors: string[] = [];
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText);
        if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules);
    return selectors;
  });
  expect(selectors.filter((selector) => selector.includes('p + p'))).toEqual(
    []
  );
  expect(
    selectors.some((selector) =>
      selector.includes(
        '.calendar-description-paragraph + .calendar-description-paragraph'
      )
    )
  ).toBe(true);
  const editor = page.locator('#editor');
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('n');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  expect(await editor.locator(':scope > p').allTextContents()).toEqual([
    'un',
    'related editor',
    'second',
  ]);
});
