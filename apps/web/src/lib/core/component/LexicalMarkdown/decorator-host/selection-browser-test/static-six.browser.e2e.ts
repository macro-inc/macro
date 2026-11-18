import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const baseline = process.env.FAST_DECORATOR_BASELINE;
if (!baseline)
  throw new Error('Static row proof requires frozen Source captures');
const fixture =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/selection-browser-test/fixture.html';
for (const kind of [
  'watermark',
  'await',
  'agent-context',
  'reply-target',
  'account-manager-request',
  'system-notification',
]) {
  test(`actual static ${kind} unchanged Source and matched native`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/__macro_dev/gateway/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return path.endsWith('/email/links')
        ? route.fulfill({ json: { links: [] } })
        : route.fulfill({
            status: 403,
            json: { message: 'Fixture access denied' },
          });
    });
    const sourceBaseline = ['watermark', 'await', 'agent-context'].includes(
      kind
    )
      ? process.env.FAST_DECORATOR_STATIC_BASELINE
      : baseline;
    if (!sourceBaseline)
      throw new Error('Frozen static Source baseline required');
    const file = resolve(sourceBaseline, `${info.project.name}-${kind}.json`);
    {
      const saved: unknown = JSON.parse(await readFile(file, 'utf8'));
      const input: unknown =
        typeof saved === 'object' && saved !== null
          ? Reflect.get(saved, 'model')
          : undefined;
      if (typeof input !== 'string')
        throw new Error('Invalid frozen Source capture');
      await page.addInitScript((input) => {
        window.fastSelectionInput = input;
      }, input);
    }
    const captures = [];
    for (const engine of ['source-factory', 'lexical', 'native']) {
      await page.goto(
        `${fixture}?kind=${kind}&engine=${engine === 'source-factory' ? 'lexical' : engine}${engine === 'source-factory' ? '' : '&trace=import'}`
      );
      const root = page.getByRole('textbox', {
        name: 'Fast decorator fixture',
      });
      await expect
        .poll(() => page.evaluate(() => Boolean(window.fastSelectionFixture)))
        .toBe(true);
      if (kind === 'reply-target')
        await expect(
          root.getByRole('button', {
            name: 'Replying to fixture-sender: Fixture reply **content**',
          })
        ).toBeVisible();
      else if (kind === 'system-notification')
        await expect(
          root.getByRole('region', { name: 'GitHub notification' })
        ).toContainText('Fixture checks completed');
      else if (kind === 'account-manager-request')
        await expect(
          root.locator('[data-account-manager-request]')
        ).toContainText('This request isn’t available');
      else if (kind === 'watermark')
        await expect(root.locator('[data-watermark]')).toHaveText(
          'Fixture watermark'
        );
      else if (kind === 'await')
        await expect(
          root.locator(
            '[data-await-id="fixture-await"]:not([data-lexical-decorator])'
          )
        ).toHaveText('Waiting for fixture');
      else await expect(root.locator('div[hidden]')).toHaveCount(1);
      const capture = await page.evaluate(() => {
        const fixture = window.fastSelectionFixture;
        if (!fixture) throw new Error('Missing actual fixture');
        return fixture.snapshot();
      });
      if (kind === 'reply-target') {
        await root
          .getByRole('button', {
            name: 'Replying to fixture-sender: Fixture reply **content**',
          })
          .click();
        expect(
          await page.evaluate(() => window.fastReplyNavigations)
        ).toMatchObject([
          {
            parent: { type: 'channel', id: 'fixture-channel' },
            targetMessageId: 'fixture-message',
            targetThreadId: 'fixture-thread',
            displayText: 'Fixture reply **content**',
            senderId: 'fixture-sender',
          },
        ]);
        expect(
          await page.evaluate(() => window.fastSelectionFixture?.snapshot())
        ).toEqual(capture);
      }
      if (engine === 'source-factory')
        expect(JSON.stringify(capture)).toBe(await readFile(file, 'utf8'));
      else captures.push(capture);
      await info.attach(`${engine}-${kind}.json`, {
        body: JSON.stringify(capture),
        contentType: 'application/json',
      });
    }
    expect(JSON.stringify(captures[1])).toBe(JSON.stringify(captures[0]));
    expect(errors).toEqual([]);
  });
}
