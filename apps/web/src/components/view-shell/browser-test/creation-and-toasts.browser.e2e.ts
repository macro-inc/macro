import { expect, type Locator, type Page, test } from '@playwright/test';

const fixture =
  '/src/components/view-shell/browser-test/creation-and-toasts.html';
for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.name === 'phone' });
    test(`creation choices and notifications on ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(fixture);
      const tabs = page.getByRole('radiogroup', { name: 'Channel views' });
      await tabs.getByText('Calls', { exact: true }).click();
      await expect(
        tabs.getByRole('radio', { name: 'Calls', exact: true })
      ).toBeChecked();
      if (viewport.name === 'desktop') {
        const labels = tabs.locator('label');
        const first = await labels.nth(0).boundingBox();
        const second = await labels.nth(1).boundingBox();
        const gap = second!.x - first!.x - first!.width;
        expect(gap).toBeGreaterThanOrEqual(2);
        expect(gap).toBeLessThanOrEqual(5);
      }
      await page
        .getByRole('button', { name: 'New task, subtask, project, or tag' })
        .click();
      const menu = page.getByRole('menu');
      await expect(
        menu.getByText(
          'Choose a parent task and break its work into a smaller step.'
        )
      ).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Show notices' }).click();
      await expect(page.locator('[data-macro-toast]')).toHaveCount(
        viewport.name === 'desktop' ? 3 : 1
      );
      await page.getByRole('button', { name: 'Show prompt' }).click();
      await expect(
        page.getByText('Demo only — no account changes.')
      ).toBeVisible();
      await page.getByRole('button', { name: 'Review', exact: true }).click();
      await expect(
        page.getByText('Reviewed demo — this preview does not save data.')
      ).toBeVisible();
    });
  });
}

async function swipe(page: Page, toast: Locator, deltaX: number, deltaY = 0) {
  const bounds = await toast.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width / 2;
  const y = bounds!.y + bounds!.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 4; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (deltaX * step) / 4, y: y + (deltaY * step) / 4 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await session.detach();
}

test.describe('mobile swipe dismissal', () => {
  test.use({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    contextOptions: { reducedMotion: 'reduce' },
  });

  for (const direction of ['left', 'right'] as const) {
    test(`dismisses notices, prompts, and reminders to the ${direction}`, async ({
      page,
    }) => {
      await page.goto(fixture);
      const deltaX = direction === 'left' ? -120 : 120;
      const toast = page.locator('[data-macro-toast]');

      await page.getByRole('button', { name: 'Show notices' }).click();
      await expect(toast).toHaveCount(1);
      await swipe(page, toast, 0, -70);
      await expect(toast).toHaveCount(1);
      await swipe(page, toast, deltaX / 4);
      await expect(toast).toHaveCount(1);
      await swipe(page, toast, deltaX);
      await expect(toast).toHaveCount(0);

      await page.getByRole('button', { name: 'Show prompt' }).click();
      await toast.getByRole('button', { name: 'Review' }).click();
      await expect(
        page.getByText('Reviewed demo — this preview does not save data.')
      ).toBeVisible();
      await swipe(page, toast, deltaX);
      await expect(toast).toHaveCount(0);
      await expect(
        page.getByText('Dismissals: 1', { exact: true })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Show reminder' }).click();
      await swipe(page, toast, deltaX);
      await expect(toast).toHaveCount(0);
      await expect(
        page.getByText('Dismissals: 2', { exact: true })
      ).toBeVisible();
    });
  }
});
