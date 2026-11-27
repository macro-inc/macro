import { expect, type Locator, type Page } from '@playwright/test';

/** The entity picker's scroller, which mounts only the rows in view. */
export const entityList = (page: Page) =>
  page
    .locator('[data-entity-index]')
    .first()
    .locator('xpath=ancestor::*[contains(@class, "overflow-y-auto")][1]');

/** Scrolls the picker's list to its end, as reading to the end does. */
export async function scrollToEnd(page: Page) {
  await entityList(page).evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
}

/** Reads through the picker's list until a row is in view. */
export async function readTo(page: Page, row: Locator) {
  await expect(async () => {
    await entityList(page).evaluate((list) => {
      const end = list.scrollHeight - list.clientHeight;
      list.scrollTop =
        list.scrollTop >= end - 1 ? 0 : list.scrollTop + list.clientHeight / 2;
    });
    await expect(row).toBeInViewport({ timeout: 100 });
  }).toPass({ timeout: 20_000, intervals: [20] });
}
