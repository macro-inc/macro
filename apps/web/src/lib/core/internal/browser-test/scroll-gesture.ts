import type { Locator } from '@playwright/test';

/**
 * Scrolls a list by the wheel, in phone layouts too: this headless Chromium
 * synthesizes no touch scrolling, and paging reads only the list's scroll
 * position, whatever moved it.
 */
export async function scrollList(list: Locator, distance = 2000) {
  await list.hover();
  await list.page().mouse.wheel(0, distance);
}
