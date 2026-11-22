import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const PATH =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/creation-browser-test/fixture.html';

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.route('**/__macro_dev/gateway/**', (route) =>
    route.fulfill({ json: { links: [] } })
  );
  try {
    await page.goto(PATH);
    await expect
      .poll(() => page.evaluate(() => !!window.creationProof))
      .toBe(true);
    await page.evaluate(() => window.creationProofClose?.());
  } finally {
    try {
      await page.evaluate(() => window.creationProofClose?.());
    } finally {
      await context.close();
    }
  }
});

for (const kind of ['task', 'document']) {
  test(`actual Source ${kind} callbacks retain literal completed editor stages`, async ({
    page,
  }, info) => {
    const finish = watchCompiledSourceDeps(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture unavailable' } })
    );
    await page.clock.setFixedTime(new Date('2020-01-01T00:00:00Z'));
    const records = [];
    try {
      await page.goto(PATH);
      await expect
        .poll(() => page.evaluate(() => !!window.creationProof))
        .toBe(true);
      records.push(await page.evaluate(() => window.creationProof?.capture()));
      await page.evaluate((kind) => {
        if (kind !== 'task' && kind !== 'document')
          throw new Error('Invalid fixture kind');
        window.creationProof?.open(kind);
        window.creationProof?.start();
      }, kind);
      await expect(page.locator('.macro-await-node')).toHaveCount(1);
      await page.evaluate(() => window.creationProof?.fail());
      await expect(page.locator('.macro-await-node')).toHaveCount(0);
      records.push(await page.evaluate(() => window.creationProof?.capture()));
      await page.evaluate(async () => {
        window.creationProof?.start();
        await window.creationProof?.succeed();
      });
      await expect(page.locator('[data-document-mention]')).toHaveCount(1);
      records.push(await page.evaluate(() => window.creationProof?.capture()));
      expect(records[2]?.model).toContain('"documentId":"created-fixture"');
      expect(records[2]?.model).toContain(
        `"blockName":"${kind === 'task' ? 'task' : 'md'}"`
      );
      expect(errors).toEqual([]);
      if (process.env.CREATION_SOURCE_CAPTURE)
        writeFileSync(
          `${process.env.CREATION_SOURCE_CAPTURE}/${info.project.name}-${kind}.json`,
          JSON.stringify(records)
        );
    } finally {
      try {
        const compiled = await finish();
        await info.attach('source-creation.json', {
          contentType: 'application/json',
          body: JSON.stringify({ records, errors, compiled }),
        });
      } finally {
        await page.evaluate(() => window.creationProofClose?.());
      }
    }
  });
}
