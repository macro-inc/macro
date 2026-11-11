import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from './compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/contact-browser-test/fixture.html';
async function gateway(page: Page) {
  await page.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
}
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await gateway(page);
    await page.goto(`${path}?engine=factory`);
    await expect(page.locator('[data-contact-mention="true"]')).toHaveText(
      'Contact Example'
    );
    await page.evaluate(() => window.contactProofFixture?.close());
  } finally {
    await page.close();
  }
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.contactProofClose?.());
});

for (const mode of ['ordinary', 'clear-selection']) {
  test(`Contact published selection and actual Normal Enter ${mode}`, async ({
    page,
  }, info) => {
    const finishCompiledProof = watchCompiledSourceDeps(page);
    const errors: string[] = [];
    const navigation: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.text().includes('No split manager'))
        navigation.push(message.text());
    });
    await gateway(page);
    await page.goto(`${path}?engine=factory&before-enter=${mode}`);
    const contact = page.locator('[data-contact-mention="true"]');
    await expect(contact).toHaveText('Contact Example');
    const capture = () =>
      page.evaluate(() => {
        if (!window.contactProofFixture)
          throw new Error('Missing actual fixture');
        return window.contactProofFixture.snapshot();
      });
    const initial = await capture();
    const unselectedHandled = await page.evaluate(() =>
      window.contactProofFixture?.enter()
    );
    expect(unselectedHandled).toBe(false);
    await page.evaluate(() => window.contactProofFixture?.select());
    await expect(contact.locator('..')).toHaveClass(/bg-active/);
    const selected = await capture();
    const selectedHandled = await page.evaluate(() =>
      window.contactProofFixture?.enter()
    );
    expect(selectedHandled).toBe(true);
    if (mode === 'clear-selection')
      await expect(contact.locator('..')).not.toHaveClass(/bg-active/);
    else await expect(contact.locator('..')).toHaveClass(/bg-active/);
    const afterEnter = await capture();
    expect(afterEnter.model).toBe(initial.model);
    expect(errors).toEqual([]);
    expect(navigation).toHaveLength(1);
    const result = {
      initial,
      selected,
      afterEnter,
      unselectedHandled,
      selectedHandled,
      navigationBoundary:
        'actual split manager unavailable; no navigation acceptance',
      navigation,
      errors,
    };
    const stem = `/home/wolf/tmp/lexical-port/contact-proof/${info.project.name}-${mode}`;
    if (process.env.CONTACT_PHASE === 'before')
      writeFileSync(`${stem}-before.json`, JSON.stringify(result));
    else
      expect(result).toEqual(
        JSON.parse(readFileSync(`${stem}-before.json`, 'utf8'))
      );
    await info.attach('contact-capture.json', {
      body: JSON.stringify({
        ...result,
        compiledProof: await finishCompiledProof(),
      }),
      contentType: 'application/json',
    });
    await page.evaluate(() => window.contactProofFixture?.close());
  });
}
