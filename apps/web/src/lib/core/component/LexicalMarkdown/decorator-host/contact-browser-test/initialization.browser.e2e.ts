import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './fixture';

test('closing during actual WASM initialization prevents a late Contact mount', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release: (() => void) | undefined;
  let announce: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const allowed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__macro_dev/gateway/**', (route) =>
    new URL(route.request().url()).pathname.endsWith('/email/links')
      ? route.fulfill({ json: { links: [] } })
      : route.fulfill({
          status: 403,
          json: { message: 'Fixture access denied' },
        })
  );
  await page.route('**/document_session_wasm_bg.wasm*', async (route) => {
    announce?.();
    await allowed;
    await route.continue();
  });
  const input = process.env.CONTACT_CANONICAL_INPUT;
  if (!input) throw new Error('Missing actual Source-export input');
  await page.addInitScript(
    (value) => {
      window.contactProofInput = value;
    },
    readFileSync(input, 'utf8')
  );
  try {
    await page.goto(
      '/src/lib/core/component/LexicalMarkdown/decorator-host/contact-browser-test/fixture.html?engine=native',
      { waitUntil: 'domcontentloaded' }
    );
    await blocked;
    await page.evaluate(async () => {
      if (!window.contactProofClose) throw new Error('Missing setup cleanup');
      await window.contactProofClose();
    });
    release?.();
    await page.evaluate(async () => {
      if (!window.contactProofInitializing)
        throw new Error('Missing actual WASM initialization');
      await window.contactProofInitializing;
    });
    expect(
      await page.evaluate(() => window.contactProofFixture === undefined)
    ).toBe(true);
    await expect(page.locator('[data-lexical-decorator]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await page.evaluate(() => window.contactProofClose?.());
  }
});
