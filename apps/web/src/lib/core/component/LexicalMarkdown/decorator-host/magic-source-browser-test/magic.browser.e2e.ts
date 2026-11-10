import { expect, test } from '@playwright/test';

const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/magic-source-browser-test/fixture.html';
test('actual Source mounts ordinary, admitted and missing Magic inputs unchanged', async ({
  page,
}, info) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const captures = [];
  for (const kind of ['ordinary', 'admitted', 'missing']) {
    const input = JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        $: {
          id: 'fast-decorator-root',
          documentMetadata: { version: 10, environmentTags: null },
        },
        children: [
          {
            type: 'magic-chip',
            version: 5,
            $: { id: 'fast-magic-node' },
            agentSessionId: 'fixture-agent',
            ...(kind === 'admitted'
              ? { channelId: null, promptedMessage: [0, 'user'] }
              : kind === 'ordinary'
                ? { promptedMessage: { turn: 0, author: 'user' } }
                : {}),
            status: 'no_messages',
          },
        ],
      },
    });
    await page.addInitScript((value) => {
      window.magicSourceInput = value;
    }, input);
    await page.route('**/__macro_dev/gateway/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return path.endsWith('/email/links')
        ? route.fulfill({ json: { links: [] } })
        : route.fulfill({
            status: 403,
            json: { message: 'Fixture access denied' },
          });
    });
    await page.goto(`${fixture}?engine=lexical&trace=import&kind=magic-chip`);
    await expect
      .poll(() => page.evaluate(() => Boolean(window.magicSourceFixture)))
      .toBe(true);
    const root = page.getByRole('textbox', { name: 'Fast decorator fixture' });
    await expect(
      root.locator(
        '[data-magic-chip="fixture-agent"]:not([data-lexical-decorator])'
      )
    ).toBeVisible();
    await expect(root.locator('[data-magic-chip-card]')).toHaveAttribute(
      'aria-busy',
      'false'
    );
    const actual = await page.evaluate(() => {
      const current = window.magicSourceFixture;
      if (!current) throw new Error('Missing real Source fixture');
      return { capture: current.snapshot(), trace: current.trace() };
    });
    expect(actual.trace).toEqual({
      mode: 'import',
      beforeImportDecorators: 0,
      firstObservation: 'after-import',
    });
    const child = JSON.parse(actual.capture.model).root.children[0];
    if (kind === 'missing') expect(child).not.toHaveProperty('promptedMessage');
    else
      expect(child.promptedMessage).toEqual(
        kind === 'admitted' ? [0, 'user'] : { turn: 0, author: 'user' }
      );
    if (kind === 'admitted') expect(child.channelId).toBeNull();
    captures.push(actual.capture);
    await info.attach(`source-${kind}-magic.json`, {
      body: JSON.stringify(actual),
      contentType: 'application/json',
    });
  }
  expect(captures[1]?.dom).toBe(captures[0]?.dom);
  expect(captures[1]?.shadows).toEqual(captures[0]?.shadows);
  expect(captures[2]?.dom).toBe(captures[0]?.dom);
  expect(captures[2]?.shadows).toEqual(captures[0]?.shadows);
  expect(pageErrors).toEqual([]);
});
