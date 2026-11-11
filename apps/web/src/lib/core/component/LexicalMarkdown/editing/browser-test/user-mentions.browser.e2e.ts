import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
const externalRequests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', (error) => failures.push(error.message));
  const external: string[] = [];
  externalRequests.set(page, external);
  await page.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.hostname !== '127.0.0.1') external.push(url.origin);
    return socket.close();
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      external.push(url.origin);
      return route.abort();
    }
    if (url.pathname === '/auth/user/profile_pictures')
      return route.fulfill({ json: { pictures: [] } });
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('actual-menu-page', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await info.attach('fixture-network-and-page-errors', {
    body: JSON.stringify(
      {
        external: externalRequests.get(page),
        errors: errors.get(page),
        boot: await page.evaluate(() => window.nativeUserMenuBoot),
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  expect(
    externalRequests.get(page),
    'fixture must never request production or another external host'
  ).toEqual([]);
  expect(errors.get(page)).toEqual([]);
});
async function load(
  page: Page,
  engine: 'source' | 'native' | 'hosted',
  options = ''
) {
  await page.goto('/user-mentions.html?engine=' + engine + options);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}
async function capture(page: Page) {
  return page.evaluate(() => {
    const fixture = window.nativeUserMenu;
    if (!fixture) throw new Error('Missing actual mention integration fixture');
    return fixture.capture();
  });
}
async function open(page: Page) {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('@');
  await expect(
    page.locator('.menu-surface [title="Example User fixture@example.com"]')
  ).toBeVisible();
  return body;
}
for (const engine of ['source', 'native'] as const) {
  for (const mode of ['keyboard', 'pointer'] as const) {
    test(
      engine +
        ' actual user choice via ' +
        mode +
        ' inserts and renders the shared mention',
      async ({ page, hasTouch }, info) => {
        await load(page, engine);
        const body = await open(page);
        const opened = await capture(page);
        await page.keyboard.type('User');
        const choice = page.locator(
          '.menu-surface [title="Example User fixture@example.com"]'
        );
        await expect(
          page.locator('.menu-surface [title="Other Person other@example.com"]')
        ).toHaveCount(0);
        const query = await capture(page);
        if (mode === 'keyboard') await page.keyboard.press('Enter');
        else if (hasTouch) await choice.tap();
        else await choice.click();
        await expect(page.locator('.menu-surface')).toHaveCount(0);
        await expect(body.locator('[data-user-mention]')).toHaveAttribute(
          'data-user-id',
          'macro|fixture@example.com'
        );
        await expect(body.locator('[data-user-mention]')).toContainText(
          '@Example'
        );
        await expect(page.locator('#live-state')).toContainText(
          '"type":"user-mention"'
        );
        const inserted = await capture(page);
        const raw = JSON.stringify({ opened, query, inserted }, null, 2);
        await info.attach('raw-current-menu-and-model', {
          body: raw,
          contentType: 'application/json',
        });
        if (process.env.NATIVE_USER_MENU_CAPTURE)
          writeFileSync(
            process.env.NATIVE_USER_MENU_CAPTURE +
              '/' +
              info.project.name +
              '-' +
              engine +
              '-' +
              mode +
              '.json',
            raw
          );
      }
    );
  }
  test(
    engine +
      ' shared Escape closes the visible picker and preserves literal query',
    async ({ page }) => {
      await load(page, engine);
      const body = await open(page);
      await page.keyboard.type('Ex');
      await page.keyboard.press('Escape');
      await expect(page.locator('.menu-surface')).toHaveCount(0);
      await expect(body).toHaveText('@Ex');
      await page.keyboard.type(' after');
      await expect(body).toHaveText('@Ex after');
    }
  );
}
test('shared USER menu raw DOM equals OFF with identical inputs and geometry', async ({
  page,
}, info) => {
  await load(page, 'source');
  await open(page);
  const source = await capture(page);
  await load(page, 'native');
  await open(page);
  const native = await capture(page);
  const raw = JSON.stringify({ source, native }, null, 2);
  await info.attach('unmodified-source-native-menu-DOM', {
    body: raw,
    contentType: 'application/json',
  });
  if (process.env.NATIVE_USER_MENU_CAPTURE)
    writeFileSync(
      process.env.NATIVE_USER_MENU_CAPTURE +
        '/' +
        info.project.name +
        '-literal-menu-pair.json',
      raw
    );
  expect(native.menus).toEqual(source.menus);
});
test('native installation close removes the visible UI and actual document listeners', async ({
  page,
}) => {
  await load(page, 'native');
  await open(page);
  await page.evaluate(async () => {
    const fixture = window.nativeUserMenu;
    if (!fixture) throw new Error('Missing native mention fixture');
    await fixture.close();
  });
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
});

for (const disposed of [false, true]) {
  test(
    'queued actual REMOVE precedes notification; disposed=' + disposed,
    async ({ page }) => {
      await load(page, 'native');
      const body = await open(page);
      const result = await page.evaluate(async (disposed) => {
        const pick = window.nativeUserMenu?.queuedPick;
        if (!pick) throw new Error('Missing actual queued host control');
        return pick(disposed);
      }, disposed);
      expect(result.beforeDrain).toBe(0);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0]).not.toContain('inline-search');
      await expect(body.locator('[data-user-mention]')).toHaveCount(
        disposed ? 0 : 1
      );
    }
  );
}

test('actual app factory waits for first projection before querying and opens the native picker', async ({
  page,
}) => {
  await load(page, 'hosted');
  const boot = await page.evaluate(() => window.nativeUserMenuBoot);
  expect(boot?.generationAtInstall).toBeNull();
  expect(boot?.queriesAtInstall).toBe(0);
  expect(boot?.queryCount).toBe(1);
  const body = await open(page);
  await page.keyboard.press('Enter');
  await expect(body.locator('[data-user-mention]')).toHaveCount(1);
  expect(await page.evaluate(() => window.nativeUserMenuBoot?.queryCount)).toBe(
    1
  );
});

for (const timing of ['immediate', 'deferred']) {
  test(
    'actual app factory keeps document editing when an optional menu snapshot is invalid: ' +
      timing,
    async ({ page }) => {
      const reported = page.waitForEvent('console', {
        predicate: (message) =>
          message.type() === 'error' &&
          message
            .text()
            .includes('Invalid native inline-search controller snapshot'),
      });
      await load(page, 'hosted', '&invalidSnapshot=' + timing);
      await reported;
      const boot = await page.evaluate(() => window.nativeUserMenuBoot);
      expect(boot?.queryCount).toBe(1);
      expect(boot?.overlaysAtInstall).toBe(timing === 'deferred');
      const body = page.getByRole('textbox', { name: 'Body', exact: true });
      await body.click();
      await page.keyboard.type('@plain document');
      await expect(body).toHaveText('@plain document');
      await expect(page.locator('.menu-surface')).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(body.locator('p')).toHaveCount(2);
      await page.keyboard.type('still editable');
      await expect(body).toContainText('still editable');
      expect(
        await page.evaluate(() => window.nativeUserMenuBoot?.queryCount)
      ).toBe(1);
    }
  );
}

test('actual app factory disposes pending menu before first projection without querying', async ({
  page,
}) => {
  await load(page, 'hosted', '&closeBeforeProjection=1');
  const boot = await page.evaluate(() => window.nativeUserMenuBoot);
  expect(boot?.generationAtInstall).toBeNull();
  expect(boot?.queriesAtInstall).toBe(0);
  expect(boot?.queryCount).toBe(0);
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('@ordinary text');
  await expect(body).toHaveText('@ordinary text');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  expect(await page.evaluate(() => window.nativeUserMenuBoot?.queryCount)).toBe(
    0
  );
});
