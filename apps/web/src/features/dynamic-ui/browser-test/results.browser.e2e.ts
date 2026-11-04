import { expect, test } from '@playwright/test';

for (const width of [1100, 480, 320]) {
  test(`task titles remain readable in a ${width}px results container`, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/');
    await page.locator('#results').evaluate((element, value) => {
      element.style.maxWidth = `${value}px`;
    }, width);
    const groups = page.getByRole('region');
    const first = groups.nth(0);
    const second = groups.nth(1);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const boxes = await groups.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
      })
    );
    const available = await page
      .locator('#results')
      .evaluate((element) => element.clientWidth);
    if (available < 672) {
      expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].bottom);
    } else {
      expect(boxes[1].x).toBeGreaterThanOrEqual(boxes[0].right);
    }
    for (const title of await page.getByRole('button').all()) {
      const geometry = await title.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
        lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
      expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.height);
      if ((await title.innerText()).length > 20) {
        expect(geometry.height).toBeGreaterThan(geometry.lineHeight);
      }
      if (isMobile) expect(geometry.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await first.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    const title = first.getByRole('button').first();
    if (isMobile) {
      await title.tap();
    } else {
      await title.focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.getByLabel('Opened task')).toHaveText(
      await title.innerText()
    );
  });
}

test('aligned project groups keep their width when stacked', async ({
  page,
}) => {
  await page.goto('/?align-start');
  await page.locator('#results').evaluate((element) => {
    element.style.maxWidth = '320px';
  });
  const groups = page.getByRole('region');
  await expect(groups.first()).toBeVisible();
  for (const group of await groups.all()) {
    expect(
      await group.evaluate((element) => element.clientWidth)
    ).toBeGreaterThan(250);
    const title = group.getByRole('button').first();
    await expect(title).toBeVisible();
    expect(
      await title.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
  }
});
