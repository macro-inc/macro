import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { watchCompiledSourceDeps } from './compiled-source-deps';
import type {} from './fixture';

const canonical = process.env.CONTACT_NATIVE_TRACE === 'canonical-reimport';
const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/contact-browser-test/fixture.html';
for (const mode of ['ordinary', 'clear-selection']) {
  test(`actual Contact native Normal Enter ${canonical ? 'canonical reimport' : 'raw import'} ${mode}`, async ({
    browser,
  }, info) => {
    const seed: { initial: { model: string } } = JSON.parse(
      readFileSync(
        `/home/wolf/tmp/lexical-port/contact-proof/${info.project.name}-${mode}-before.json`,
        'utf8'
      )
    );
    const rawInput = seed.initial.model;
    if (canonical) {
      const input = process.env.CONTACT_CANONICAL_INPUT;
      if (!input)
        throw new Error('Missing explicit actual Source export input');
      seed.initial.model = readFileSync(input, 'utf8');
    }
    const pages: Page[] = [];
    const captures = [];
    let cleanup: PromiseSettledResult<void>[] = [];
    try {
      for (const engine of ['source', 'native']) {
        const page = await browser.newPage();
        pages.push(page);
        const compiled = watchCompiledSourceDeps(page);
        const errors: string[] = [];
        const navigation: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.text().includes('No split manager'))
            navigation.push(message.text());
        });
        await page.route('**/__macro_dev/gateway/**', (route) =>
          new URL(route.request().url()).pathname.endsWith('/email/links')
            ? route.fulfill({ json: { links: [] } })
            : route.fulfill({
                status: 403,
                json: { message: 'Fixture access denied' },
              })
        );
        await page.addInitScript((input) => {
          window.contactProofInput = input;
        }, seed.initial.model);
        await page.goto(`${path}?engine=${engine}&before-enter=${mode}`);
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
        expect(errors).toEqual([]);
        expect(navigation).toHaveLength(1);
        expect(afterEnter.model).toBe(initial.model);
        captures.push({
          engine,
          initial,
          selected,
          afterEnter,
          unselectedHandled,
          selectedHandled,
          errors,
          navigation,
          compiled: await compiled(),
        });
        await page.evaluate(() => window.contactProofFixture?.close());
      }
      const result = {
        seed: seed.initial.model,
        rawInput,
        trace: canonical
          ? 'actual Source-exported canonical snapshot reimported by both engines; raw metadata mismatch remains open'
          : 'raw Source-factory snapshot imported by both engines',
        captures,
        navigationBoundary: 'no actual split manager; no navigation acceptance',
      };
      writeFileSync(
        `/home/wolf/tmp/lexical-port/contact-proof/${info.project.name}-${mode}-native-${canonical ? 'canonical' : 'raw'}.json`,
        JSON.stringify(result)
      );
      await info.attach('native-raw-contact.json', {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      expect(captures[1]?.initial).toEqual(captures[0]?.initial);
      expect(captures[1]?.selected).toEqual(captures[0]?.selected);
      expect(captures[1]?.afterEnter).toEqual(captures[0]?.afterEnter);
    } finally {
      cleanup = await Promise.allSettled(
        pages.map(async (page) => {
          try {
            await page.evaluate(() => window.contactProofClose?.());
          } finally {
            await page.close();
          }
        })
      );
    }
    expect(cleanup.every((result) => result.status === 'fulfilled')).toBe(true);
  });
}
