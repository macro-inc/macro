import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const path =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/gif-browser-test/fixture.html';

test('post-consume hook omits the actual committed insertion when its listener throws', async ({
  context,
}, info) => {
  const factory = await context.newPage();
  const native = await context.newPage();
  const finish = watchCompiledSourceDeps(factory);
  const errors: string[] = [];
  native.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/__macro_dev/gateway/**', (route) =>
    route.fulfill({ json: { links: [] } })
  );
  try {
    await factory.goto(`${path}?engine=factory`);
    await expect
      .poll(() => factory.evaluate(() => !!window.gifProofFixture))
      .toBe(true);
    const model = await factory.evaluate(
      () => window.gifProofFixture?.capture().model
    );
    if (!model) throw new Error('Missing actual Source snapshot');
    await native.addInitScript((model) => {
      window.gifProofInput = model;
    }, model);
    await native.goto(`${path}?engine=native`);
    await expect
      .poll(() => native.evaluate(() => !!window.gifProofFixture))
      .toBe(true);
    await native.evaluate(() => window.gifProofFixture?.select());
    const result = await native.evaluate(() =>
      window.gifProofFixture?.probeCommitError?.()
    );
    await info.attach('commit-then-throw.json', {
      contentType: 'application/json',
      body: JSON.stringify({ result, errors, source: await finish() }),
    });
    expect(result?.sameError).toBe(true);
    expect(result?.model).toContain(
      '"id":"00000000-0000-4000-8000-000000000031"'
    );
    // The existing post-consume hook misses the committed insertion on failure.
    expect(result?.after).toEqual([]);
  } finally {
    try {
      const cleanup = await Promise.allSettled([
        factory.evaluate(() => window.gifProofClose?.()),
        native.evaluate(() => window.gifProofClose?.()),
      ]);
      expect(cleanup.map((result) => result.status)).toEqual([
        'fulfilled',
        'fulfilled',
      ]);
    } finally {
      await Promise.all([factory.close(), native.close()]);
    }
  }
});
