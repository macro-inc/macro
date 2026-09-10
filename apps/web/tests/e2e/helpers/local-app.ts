import { expect, type Locator, type Page } from '@playwright/test';
import {
  entityIdSelector,
  soupListContainerSelector,
  splitContainerSelector,
} from '../../../src/lib/core/dom-selectors';

export const LOCAL_E2E = process.env.LOCAL_E2E === 'true';

export async function gotoApp(page: Page, path: `/${string}`) {
  await page.goto(`/app${path}`);
  await expect(page).not.toHaveURL(/\/app\/(welcome|signup|login)/);
  await expect(page.locator(splitContainerSelector).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectEntityInCurrentList(
  page: Page,
  entityId: string,
  label: string
) {
  const row = page.locator(entityIdSelector(entityId)).first();

  const scroller = page.locator(soupListContainerSelector).first();

  await expect(scroller).toBeVisible({ timeout: 30_000 });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await row.count()) > 0 && (await row.isVisible())) {
      await expect(row).toContainText(label);
      return;
    }

    await scroller.evaluate((element) => {
      element.scrollBy(0, element.clientHeight * 0.9);
    });
    await page.waitForTimeout(150);
  }

  throw new Error(`Could not find seeded entity ${label} (${entityId})`);
}

export async function fillEditable(locator: Locator, text: string) {
  await expect(locator).toBeVisible({ timeout: 30_000 });
  await locator.fill(text);
}

export function uniqueE2EText(prefix: string): string {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2)}`;
}

/** Creates a markdown document through the sidebar and returns its id. */
export async function createDocument(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('menuitem', { name: /^Document/ }).click();
  await page.waitForURL(/\/app\/md\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const id = /\/app\/md\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`no document id in ${page.url()}`);
  return id;
}

/** Opens the side panel if hidden, then expands the named accordion section. */
export async function openSidePanelSection(page: Page, title: string) {
  const show = page.getByRole('button', { name: 'Show Side Panel' });
  const trigger = page.getByRole('button', { name: title, exact: true });
  await expect(show.or(trigger).first()).toBeVisible({ timeout: 30_000 });
  if (await show.isVisible()) {
    await show.click();
  }
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
}

export async function sendChannelMessage(
  page: Page,
  channelId: string,
  text: string
): Promise<Locator> {
  const input = page.locator(`[data-input-id="channel-input-${channelId}"]`);
  await fillEditable(input.locator('[contenteditable="true"]').first(), text);

  const sendButton = input.locator('[data-input-action="send"]');
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  await sendButton.click();

  const message = page
    .locator('[data-message]')
    .filter({ hasText: text })
    .last();
  await expect(message).toBeVisible({ timeout: 30_000 });
  return message;
}
