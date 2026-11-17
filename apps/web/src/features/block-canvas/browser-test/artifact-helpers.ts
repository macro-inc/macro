import type { Page } from '@playwright/test';

/** The fitted deck draws its slides too small for their own controls, so this
 * selects the slide and presents from the inspector. */
export async function presentFromInspector(page: Page, id: string) {
  const box = await page
    .locator(`[data-canvas-artifact="${id}"]`)
    .boundingBox();
  if (!box) throw new Error(`Slide ${id} is not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .getByRole('region', { name: 'Artifact' })
    .getByRole('button', { name: 'Present' })
    .click();
}
