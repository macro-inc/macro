import { expect, type Page, test } from '@playwright/test';

/** Scrolls the picker's last listed row into view, as reading to the end does. */
async function scrollToEnd(page: Page) {
  await page.locator('[data-entity-index]').last().scrollIntoViewIfNeeded();
}

const nextOptions = (page: Page) =>
  page.getByRole('button', { name: 'Next options', exact: true });

for (const [type, prefix] of [
  ['TASK', 'Task'],
  ['CONTACT', 'Contact'],
  ['MIXED', 'Task'],
] as const) {
  test(`${type} picker lists the next page as the list scrolls`, async ({
    page,
  }) => {
    await page.goto(`/?selector=${type}`);
    const first = page
      .locator('[data-entity-index]')
      .filter({ hasText: `${prefix} 00` });
    const later = page
      .locator('[data-entity-index]')
      .filter({ hasText: `${prefix} 50` });

    await expect(first).toBeVisible();
    await expect(later).toHaveCount(0);
    await expect(nextOptions(page)).toHaveCount(0);
    await scrollToEnd(page);
    await later.scrollIntoViewIfNeeded();
    await expect(later).toBeVisible();
    await expect(first).toHaveCount(1);
  });
}

test('PageDown lists the next page from the search field on desktop', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'phone', 'Keyboard paging is desktop-only');
  await page.goto('/?selector=TASK');
  const later = page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Task 50' });
  await expect(later).toHaveCount(0);
  await page.getByPlaceholder('Search options').press('PageDown');
  await expect(later).toHaveCount(1);
});

test('thread picker advances browsed emails and server search pages', async ({
  page,
}) => {
  await page.goto('/?selector=THREAD');
  const search = page.getByPlaceholder('Search options');
  const option = (name: string) =>
    page.locator('[data-entity-index]').filter({ hasText: name });

  await expect(option('Email 00')).toBeVisible();
  await expect(option('Email 50')).toHaveCount(0);
  await scrollToEnd(page);
  await option('Email 50').scrollIntoViewIfNeeded();
  await expect(option('Email 50')).toBeVisible();
  await expect(nextOptions(page)).toHaveCount(0);

  await search.fill('remote');
  await expect(option('Remote email 00')).toBeVisible();
  await expect(option('Remote email 20')).toHaveCount(0);
  await scrollToEnd(page);
  await option('Remote email 20').scrollIntoViewIfNeeded();
  await expect(option('Remote email 20')).toBeVisible();
});

test('thread picker shows email loading, failure, and successful retry', async ({
  page,
}) => {
  await page.goto('/?selector=THREAD');
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Email 00' })
  ).toBeVisible();
  await page.evaluate(() => {
    window.emailPickerFixture.holdNext();
    window.emailPickerFixture.failNext();
  });
  await scrollToEnd(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading options…' })
  ).toBeVisible();
  await page.evaluate(() => window.emailPickerFixture.release());
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toBeVisible();
  // A failed page waits for Retry rather than reading again by itself.
  const retry = page.getByRole('button', { name: 'Retry options' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Email 50' })
  ).toHaveCount(1);
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toHaveCount(0);
  await expect(retry).toHaveCount(0);
});

test('generic picker advances Quick Access and browsed email pages together', async ({
  page,
}) => {
  await page.goto('/?selector=GENERIC');
  const option = (name: string) =>
    page.locator('[data-entity-index]').filter({ hasText: name });

  await expect(option('Task 00')).toBeVisible();
  await expect(option('Task 50')).toHaveCount(0);
  await expect(option('Email 50')).toHaveCount(0);
  await scrollToEnd(page);
  await expect(option('Task 50')).toHaveCount(1);
  await expect(option('Email 50')).toHaveCount(1);
  await expect(nextOptions(page)).toHaveCount(0);
});
