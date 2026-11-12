import { expect, test } from '@playwright/test';

for (const [type, prefix] of [
  ['TASK', 'Task'],
  ['CONTACT', 'Contact'],
  ['MIXED', 'Task'],
] as const) {
  test(`${type} picker exposes the next loaded page`, async ({
    page,
  }, info) => {
    await page.goto(`/?selector=${type}`);
    const search = page.getByPlaceholder('Search options');
    const first = page
      .locator('[data-entity-index]')
      .filter({ hasText: `${prefix} 00` });
    const later = page
      .locator('[data-entity-index]')
      .filter({ hasText: `${prefix} 50` });
    const next = page.getByRole('button', {
      name: 'Next options',
      exact: true,
    });

    await expect(first).toBeVisible();
    await expect(later).toHaveCount(0);
    if (info.project.name === 'phone') await next.tap();
    else await search.press('PageDown');
    await expect(later).toBeVisible();
    await expect(next).toHaveCount(0);
  });
}

test('thread picker advances browsed emails and server search pages', async ({
  page,
}, info) => {
  await page.goto('/?selector=THREAD');
  const search = page.getByPlaceholder('Search options');
  const option = (name: string) =>
    page.locator('[data-entity-index]').filter({ hasText: name });
  const next = page.getByRole('button', { name: 'Next options', exact: true });
  const loadNext = async () => {
    if (info.project.name === 'phone') await next.tap();
    else await search.press('PageDown');
  };

  await expect(option('Email 00')).toBeVisible();
  await expect(option('Email 50')).toHaveCount(0);
  await loadNext();
  await expect(option('Email 50')).toBeVisible();
  await expect(next).toHaveCount(0);

  await search.fill('remote');
  await expect(option('Remote email 00')).toBeVisible();
  await expect(option('Remote email 20')).toHaveCount(0);
  await expect(next).toBeVisible();
  await loadNext();
  await expect(option('Remote email 20')).toBeVisible();
});

test('thread picker exposes email loading, failure, and successful retry', async ({
  page,
}, info) => {
  await page.goto('/?selector=THREAD');
  const search = page.getByPlaceholder('Search options');
  const next = page.getByRole('button', { name: 'Next options', exact: true });
  await page.evaluate(() => {
    window.emailPickerFixture.holdNext();
    window.emailPickerFixture.failNext();
  });
  if (info.project.name === 'phone') await next.tap();
  else await search.press('PageDown');
  await expect(
    page.getByRole('button', { name: 'Loading options…', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => window.emailPickerFixture.release());
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toBeVisible();
  await expect(next).toBeEnabled();
  if (info.project.name === 'phone') await next.tap();
  else await search.press('PageDown');
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Email 50' })
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toHaveCount(0);
  await expect(next).toHaveCount(0);
});

test('generic picker advances Quick Access and browsed email pages together', async ({
  page,
}, info) => {
  await page.goto('/?selector=GENERIC');
  const search = page.getByPlaceholder('Search options');
  const option = (name: string) =>
    page.locator('[data-entity-index]').filter({ hasText: name });
  const next = page.getByRole('button', { name: 'Next options', exact: true });

  await expect(option('Task 00')).toBeVisible();
  await expect(option('Task 50')).toHaveCount(0);
  await expect(option('Email 50')).toHaveCount(0);
  if (info.project.name === 'phone') await next.tap();
  else await search.press('PageDown');
  await expect(option('Task 50')).toBeVisible();
  await expect(option('Email 50')).toBeVisible();
  await expect(next).toHaveCount(0);
});
