import { expect, type Locator, test } from '@playwright/test';

const PANES = ['google', 'forwarded', 'unbroken'] as const;

async function overflow(card: Locator) {
  return card.evaluate((element) => element.scrollWidth - element.clientWidth);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/invitation.html');
  // A cold Vite server takes more than the default 5s to serve the app CSS.
  await expect(page.getByTestId('pane-google').locator('section')).toBeVisible({
    timeout: 20_000,
  });
});

for (const pane of PANES) {
  test(`${pane} description wraps inside the card`, async ({ page }) => {
    const card = page.getByTestId(`pane-${pane}`).locator('section');
    await expect.poll(() => overflow(card)).toBe(0);

    await card.getByRole('button', { name: 'Show more' }).click();
    await expect(card.getByRole('button', { name: 'Show less' })).toBeVisible();
    await expect.poll(() => overflow(card)).toBe(0);
  });
}

test('participants line up with their icon', async ({ page }) => {
  const rows = page.getByTestId('pane-google').locator('section li');
  const offsets = await rows.evaluateAll((items) =>
    items.map((item) => {
      const [icon, text] = Array.from(item.children);
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = range.getClientRects()[0];
      const glyph = icon.getBoundingClientRect();
      return Math.round(
        line.top + line.height / 2 - (glyph.top + glyph.height / 2)
      );
    })
  );
  // Schedule, location, then the participants row with its "+3 more" button.
  expect(offsets).toHaveLength(3);
  for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
});

test('the guest toggle keeps a full tap target on touch', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch devices only');
  await expect(page.locator('html')).toHaveAttribute(
    'data-touch-device',
    'true'
  );
  const toggle = page
    .getByTestId('pane-google')
    .getByRole('button', { name: '+3 more' });
  const hits = await toggle.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return [-20, 20].map((dy) =>
      button.contains(document.elementFromPoint(x, y + dy))
    );
  });
  expect(hits).toEqual([true, true]);
});
