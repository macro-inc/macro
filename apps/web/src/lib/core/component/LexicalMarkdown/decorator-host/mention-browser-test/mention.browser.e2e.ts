import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from './compiled-source-deps';
import type {} from './fixture';

const baseline = process.env.USER_MENTION_BASELINE;
if (!baseline) throw new Error('Provide an owned Source baseline directory');
const before = process.env.USER_MENTION_PHASE?.startsWith('before') === true;
const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/mention-browser-test/fixture.html';
async function ready(page: Page) {
  await expect(page.locator('[data-user-mention="true"]')).toHaveText(
    '@Fixture Mention'
  );
  await expect
    .poll(() => page.evaluate(() => !!window.userMentionFixture))
    .toBe(true);
}
async function card(page: Page) {
  await page.locator('[data-user-mention="true"]').hover();
  await expect(
    page.getByRole('button', { name: 'Copy email', exact: true })
  ).toBeVisible();
  await page.mouse.move(950, 750);
  await expect(
    page.getByRole('button', { name: 'Copy email', exact: true })
  ).toBeHidden();
}
async function capture(page: Page) {
  return page.evaluate(() => {
    if (!window.userMentionFixture)
      throw new Error('Missing actual mention fixture');
    return window.userMentionFixture.capture();
  });
}
for (const identity of [
  'ordinary',
  'missing',
  'null',
  'missing-email',
  'null-email',
  'null-uuid',
]) {
  test(`actual user mention ${identity}: Source bytes, native selection, names and authority`, async ({
    page,
    context,
    browserName,
  }, info) => {
    const errors: string[] = [];
    context.on('page', (child) =>
      child.on('pageerror', (error) => errors.push(error.message))
    );
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/__macro_dev/gateway/**', (route) =>
      new URL(route.request().url()).pathname.endsWith('/email/links')
        ? route.fulfill({ json: { links: [] } })
        : route.fulfill({
            status: 403,
            json: { message: 'Fixture access denied' },
          })
    );
    const finishSourceProof = watchCompiledSourceDeps(page);
    await page.goto(`${fixture}?identity=${identity}`);
    await ready(page);
    const initial = await capture(page);
    await page.evaluate(() => window.userMentionFixture?.select());
    await expect(
      page.locator('[data-user-mention="true"]').locator('..')
    ).toHaveClass(/bg-active/);
    const selected = await capture(page);
    await page.evaluate(() => window.userMentionFixture?.clear());
    await expect(
      page.locator('[data-user-mention="true"]').locator('..')
    ).not.toHaveClass(/bg-active/);
    const cleared = await capture(page);
    // Source renderer-derived updates do not consult the local UI lock.
    await page.evaluate(() => {
      window.userMentionFixture?.editable(false);
      window.userMentionFixture?.update('Updated Mention');
    });
    await expect(page.locator('[data-user-mention="true"]')).toHaveText(
      '@Updated Mention'
    );
    const updated = await capture(page);
    const source = { initial, selected, cleared, updated };
    const sourceProof = await finishSourceProof();
    const path = resolve(baseline, `${browserName}-${identity}.json`);
    if (before) {
      mkdirSync(baseline, { recursive: true });
      writeFileSync(path, JSON.stringify(source));
    } else {
      expect(source).toEqual(JSON.parse(readFileSync(path, 'utf8')));
      // Compare import to import on fresh surfaces; retain fresh-factory bytes above.
      const imported = await context.newPage();
      const finishImportProof = watchCompiledSourceDeps(imported);
      await imported.addInitScript((json) => {
        window.userMentionInput = json;
      }, initial.model);
      await imported.goto(`${fixture}?identity=${identity}`);
      await ready(imported);
      const importedInitial = await capture(imported);
      await card(imported);
      await imported.evaluate(() => window.userMentionFixture?.select());
      await expect(
        imported.locator('[data-user-mention="true"]').locator('..')
      ).toHaveClass(/bg-active/);
      const importedSelected = await capture(imported);
      await imported.evaluate(() => window.userMentionFixture?.clear());
      await expect(
        imported.locator('[data-user-mention="true"]').locator('..')
      ).not.toHaveClass(/bg-active/);
      const importedCleared = await capture(imported);
      await imported.evaluate(() => {
        window.userMentionFixture?.editable(false);
        window.userMentionFixture?.update('Updated Mention');
      });
      await expect(imported.locator('[data-user-mention="true"]')).toHaveText(
        '@Updated Mention'
      );
      const importedUpdated = await capture(imported);
      await info.attach('source-import.json', {
        body: JSON.stringify({
          initial: importedInitial,
          selected: importedSelected,
          cleared: importedCleared,
          updated: importedUpdated,
          sourceProof: await finishImportProof(),
        }),
        contentType: 'application/json',
      });
      await imported.close();
      const native = await context.newPage();
      await native.addInitScript((json) => {
        window.userMentionInput = json;
      }, initial.model);
      await native.goto(`${fixture}?engine=native&identity=${identity}`);
      await ready(native);
      const nativeInitial = await capture(native);
      expect(nativeInitial).toEqual(importedInitial);
      await card(native);
      await native.evaluate(() => window.userMentionFixture?.select());
      await expect(
        native.locator('[data-user-mention="true"]').locator('..')
      ).toHaveClass(/bg-active/);
      const nativeSelected = await capture(native);
      expect(nativeSelected).toEqual(importedSelected);
      await native.evaluate(() => window.userMentionFixture?.clear());
      await expect(
        native.locator('[data-user-mention="true"]').locator('..')
      ).not.toHaveClass(/bg-active/);
      const nativeCleared = await capture(native);
      expect(nativeCleared).toEqual(importedCleared);
      await native.evaluate(() => {
        window.userMentionFixture?.editable(false);
        window.userMentionFixture?.update('Updated Mention');
      });
      await expect(native.locator('[data-user-mention="true"]')).toHaveText(
        '@Updated Mention'
      );
      const nativeUpdated = await capture(native);
      expect(nativeUpdated).toEqual(importedUpdated);
      await native.evaluate(() => {
        window.userMentionFixture?.authorization?.(false);
        window.userMentionFixture?.update('Unauthorized Mention');
      });
      const nativeRead = await capture(native);
      expect(nativeRead).toEqual(importedUpdated);
      await native.evaluate(() => {
        window.userMentionFixture?.authorization?.(true);
        window.userMentionFixture?.update('Regranted Mention');
      });
      await expect(native.locator('[data-user-mention="true"]')).toHaveText(
        '@Regranted Mention'
      );
      const regranted = await capture(native);
      await native.evaluate(() => {
        window.userMentionFixture?.retireHost?.();
        window.userMentionFixture?.update('Disposed Mention');
      });
      expect(await capture(native)).toEqual(regranted);
      await info.attach('literal-pairs.json', {
        body: JSON.stringify({
          source: {
            initial: importedInitial,
            selected: importedSelected,
            cleared: importedCleared,
            updated: importedUpdated,
          },
          native: {
            initial: nativeInitial,
            selected: nativeSelected,
            cleared: nativeCleared,
            updated: nativeUpdated,
          },
        }),
        contentType: 'application/json',
      });
      const disposed = await capture(native);
      const closed = await native.evaluate(() =>
        window.userMentionFixture?.closeView?.()
      );
      expect(closed).toEqual({
        samePromise: true,
        pointerZero: true,
        componentRemoved: true,
      });
      await native.evaluate(() =>
        window.userMentionFixture?.update('After Close')
      );
      await info.attach('native-authority-and-disposal.json', {
        body: JSON.stringify({
          beforeRead: nativeUpdated,
          afterRead: nativeRead,
          regranted,
          afterDisposed: disposed,
          closed,
        }),
        contentType: 'application/json',
      });
      await native.close();
    }
    await info.attach('source.json', {
      body: JSON.stringify({ source, sourceProof }),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}

test('actual uncached mention component lifetime follows Source inside retained Portal', async ({
  page,
  context,
}, info) => {
  await context.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  const finish = watchCompiledSourceDeps(page);
  await page.goto(`${fixture}?identity=ordinary`);
  await ready(page);
  const initial = await capture(page);
  const native = await context.newPage();
  await native.addInitScript((json) => {
    window.userMentionInput = json;
  }, initial.model);
  await native.goto(`${fixture}?engine=native&identity=ordinary`);
  await ready(native);
  const facts = [];
  for (const [engine, current] of [
    ['source', page],
    ['native', native],
  ] as const) {
    const component = await current.locator('[role="link"]').elementHandle();
    const portal = await current
      .locator('[data-lexical-decorator]')
      .evaluateHandle((node) => node.firstElementChild);
    if (!component) throw new Error('Missing actual user card component');
    await card(current);
    await current.evaluate(() =>
      window.userMentionFixture?.update('Lifetime Mention')
    );
    await expect(current.locator('[data-user-mention="true"]')).toHaveText(
      '@Lifetime Mention'
    );
    facts.push({
      engine,
      componentAttached: await component.evaluate((node) => node.isConnected),
      portalRetained: await current
        .locator('[data-lexical-decorator]')
        .evaluate((node, held) => node.firstElementChild === held, portal),
    });
  }
  await info.attach('actual-component-lifetime.json', {
    body: JSON.stringify({ facts, sourceProof: await finish() }),
    contentType: 'application/json',
  });
  expect(facts).toEqual([
    { engine: 'source', componentAttached: false, portalRetained: true },
    { engine: 'native', componentAttached: false, portalRetained: true },
  ]);
  await native.close();
});
