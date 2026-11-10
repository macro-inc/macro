import { expect, type Page, test } from '@playwright/test';

async function open(page: Page, query = '') {
  await page.goto(`/src/features/database/browser-test/timeline.html?${query}`);
  await expect(page.locator('[data-gantt-header]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

function bar(page: Page, title: string) {
  return page.locator('[data-gantt-bar]', {
    has: page.getByRole('button', { name: new RegExp(`^${title}:`) }),
  });
}

/** Whether the bar's title is drawn beside it, and where both end. */
function titleBeside(page: Page, title: string) {
  return bar(page, title).evaluate((element) => {
    // The calendar clip shows `inset(0 -<room>px 0 0)` past its own left edge.
    const insideClip = (target: HTMLElement) => {
      const clip = target.closest<HTMLElement>('[data-gantt-calendar-clip]')!;
      const room = Number(/-([\d.]+)px/.exec(clip.style.clipPath)?.[1] ?? 0);
      return (
        target.getBoundingClientRect().right <=
        clip.getBoundingClientRect().left + room
      );
    };
    const body = element.querySelector<HTMLElement>('[data-gantt-bar-body]')!;
    const beside = element.querySelector<HTMLElement>(
      '[data-gantt-bar-beside]'
    );
    const shown = !!beside && getComputedStyle(beside).visibility === 'visible';
    return {
      shown,
      text: shown ? beside.textContent : null,
      gap: shown
        ? beside.getBoundingClientRect().left -
          body.getBoundingClientRect().right
        : null,
      unclipped: shown ? insideClip(beside) : null,
    };
  });
}

for (const [name, viewport, touch] of [
  ['desktop', { width: 1280, height: 720 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });

    test('a bar too short for its title shows the title beside it', async ({
      page,
    }) => {
      await open(page, 'grouped');
      // Bring the short bars into view on a phone.
      await bar(page, 'Usability test').scrollIntoViewIfNeeded();
      await expect
        .poll(() => titleBeside(page, 'Usability test'))
        .toMatchObject({
          shown: true,
          text: 'Usability test',
          unclipped: true,
        });
      const usability = await titleBeside(page, 'Usability test');
      expect(usability.gap).toBeGreaterThanOrEqual(4);
      expect(usability.gap).toBeLessThanOrEqual(8);

      // A one-hour meeting at week zoom is a sliver; its title is beside it.
      await bar(page, 'Kickoff meeting').scrollIntoViewIfNeeded();
      await expect
        .poll(() => titleBeside(page, 'Kickoff meeting'))
        .toMatchObject({ shown: true, text: 'Kickoff meeting' });

      // A bar its title fits keeps it inside, once.
      await bar(page, 'Build the prototype').scrollIntoViewIfNeeded();
      expect(await titleBeside(page, 'Build the prototype')).toMatchObject({
        shown: false,
      });

      // Zooming in far enough gives the short bar room for its own title.
      await bar(page, 'Usability test').scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Timeline settings' }).click();
      await page.getByRole('menuitemradio', { name: 'Day' }).click();
      await page.keyboard.press('Escape');
      await bar(page, 'Usability test').scrollIntoViewIfNeeded();
      await expect
        .poll(() => titleBeside(page, 'Usability test'))
        .toMatchObject({ shown: false });
    });

    test('a truncated field keeps a fitting title inside its bar', async ({
      page,
    }) => {
      await open(page, 'fields');
      await bar(page, 'Build the prototype').scrollIntoViewIfNeeded();
      // The field is cut at its cap, on the bar's one visible line.
      const field = await bar(page, 'Build the prototype')
        .getByText(/^Covers the editor/)
        .evaluate((element) => {
          const body = element
            .closest('[data-gantt-bar-body]')!
            .getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return {
            cut: element.scrollWidth > element.clientWidth,
            onBar: box.top >= body.top && box.bottom <= body.bottom,
            shown:
              getComputedStyle(element).visibility === 'visible' &&
              box.left < innerWidth,
          };
        });
      expect(field).toEqual({ cut: true, onBar: true, shown: true });
      expect(await titleBeside(page, 'Build the prototype')).toMatchObject({
        shown: false,
      });
    });

    test('the view menu sits with the timeline controls', async ({ page }) => {
      await open(page);
      const controls = page.getByRole('group', { name: 'Timeline controls' });
      await expect(
        controls.getByRole('button', { name: 'Timeline menu' })
      ).toBeVisible();
      // Nothing takes a band of its own above the calendar.
      const header = page.locator('[data-gantt-header]');
      expect((await header.boundingBox())?.y).toBe(0);
      await controls.getByRole('button', { name: 'Timeline menu' }).click();
      await expect(
        page.getByRole('menuitem', { name: /Group by/ })
      ).toBeVisible();
    });
  });
}
