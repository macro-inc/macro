import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from './compiled-source-deps';
import type {} from './fixture';

const baseline = process.env.DOCUMENT_MENTION_BASELINE;
if (!baseline) throw new Error('Provide Source baseline directory');
test.beforeAll(async ({ browser, baseURL }) => {
  const page = await browser.newPage();
  try {
    await page.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    await page.goto(
      `${baseURL}/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=md`
    );
    await expect(page.getByRole('textbox')).toContainText('Fixture Document');
  } finally {
    await page.close();
  }
});
const shape = process.env.DOCUMENT_MENTION_SHAPE ?? 'mention';
for (const kind of ['md', 'task', 'routine'])
  test(`Source document ${shape} ${kind} raw bytes and published selection`, async ({
    page,
    context,
    browserName,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    const finish = watchCompiledSourceDeps(page);
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=${kind}&shape=${shape}`
    );
    await expect(page.getByRole('textbox')).toContainText('Fixture Document');
    await expect
      .poll(() => page.evaluate(() => !!window.documentMentionFixture))
      .toBe(true);
    const initial = await page.evaluate(() =>
      window.documentMentionFixture!.capture()
    );
    await page.evaluate(() => window.documentMentionFixture!.select());
    const selected = await page.evaluate(() =>
      window.documentMentionFixture!.capture()
    );
    await page.evaluate(() => window.documentMentionFixture!.clear());
    const cleared = await page.evaluate(() =>
      window.documentMentionFixture!.capture()
    );
    const captures = { initial, selected, cleared };
    mkdirSync(baseline, { recursive: true });
    const path = resolve(baseline, `${browserName}-${shape}-${kind}.json`);
    if (process.env.DOCUMENT_MENTION_PHASE === 'before')
      writeFileSync(path, JSON.stringify(captures, null, 2));
    else expect(captures).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    await info.attach('source-raw', {
      body: JSON.stringify(captures),
      contentType: 'application/json',
    });
    await info.attach('source-dependency-proof', {
      body: JSON.stringify(await finish()),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });

for (const shape of ['mention', 'card'])
  test(`Source nullable ${shape} import preserves actual component props`, async ({
    page,
    context,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    const finish = watchCompiledSourceDeps(page);
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=md&shape=${shape}&admission=null`
    );
    await expect(page.getByRole('textbox')).toContainText('Fixture Document');
    const props = await page.evaluate(() =>
      window.documentMentionFixture!.componentProps()
    );
    expect(props).toMatchObject(
      shape === 'card'
        ? { mentionUuid: null, previewData: null }
        : { mentionUuid: null, channelType: null }
    );
    await info.attach('source-actual-component-props', {
      body: JSON.stringify(props),
      contentType: 'application/json',
    });
    await info.attach('source-raw', {
      body: JSON.stringify(
        await page.evaluate(() => window.documentMentionFixture!.capture())
      ),
      contentType: 'application/json',
    });
    await info.attach('source-dependency-proof', {
      body: JSON.stringify(await finish()),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });

for (const boundary of ['source', 'native'])
  test(`nested Source preview under ${boundary} host boundary`, async ({
    page,
    context,
    browserName,
  }, info) => {
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    const finish = watchCompiledSourceDeps(page);
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?boundary=${boundary}`
    );
    await expect(page.locator('[data-boundary-preview]')).toContainText(
      'Preview User'
    );
    await expect(page.locator('[data-boundary-error]')).toHaveCount(0);
    const capture = await page.evaluate(() => window.staticBoundaryCapture!());
    const path = resolve(
      baseline,
      `${browserName}-static-source-boundary.json`
    );
    if (process.env.STATIC_HOST_PHASE === 'before' && boundary === 'source')
      writeFileSync(path, JSON.stringify(capture, null, 2));
    else expect(capture).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    await info.attach('source-static-raw', {
      body: JSON.stringify(capture),
      contentType: 'application/json',
    });
    await info.attach('source-dependency-proof', {
      body: JSON.stringify(await finish()),
      contentType: 'application/json',
    });
  });

for (const shape of ['mention', 'card'])
  test(`actual Source ${shape} click routes through app split manager`, async ({
    page,
    context,
    browserName,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    const finish = watchCompiledSourceDeps(page);
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=md&shape=${shape}&navigation=real`
    );
    await expect(page.getByRole('textbox')).toContainText('Fixture Document');
    await expect(page.locator('[data-split-targets]')).toHaveAttribute(
      'data-ready',
      'true'
    );
    const initial = await page.evaluate(() =>
      window.documentMentionFixture!.capture()
    );
    if (shape === 'card')
      await page
        .getByRole('link', { name: 'Fixture Document', exact: true })
        .click();
    else
      await page
        .getByRole('textbox')
        .getByText('Fixture Document', { exact: true })
        .click();
    await expect(page.locator('[data-split-targets]')).toContainText(
      '00000000-0000-7000-8000-000000000071'
    );
    const targets = await page.locator('[data-split-targets]').innerText();
    const after = await page.evaluate(() =>
      window.documentMentionFixture!.capture()
    );
    expect(after.model).toBe(initial.model);
    const capture = { initial, after, targets };
    const path = resolve(baseline, `${browserName}-${shape}-navigation.json`);
    if (process.env.DOCUMENT_MENTION_PHASE === 'before')
      writeFileSync(path, JSON.stringify(capture, null, 2));
    else expect(capture).toEqual(JSON.parse(readFileSync(path, 'utf8')));
    await info.attach('source-navigation', {
      body: JSON.stringify(capture),
      contentType: 'application/json',
    });
    await info.attach('source-dependency-proof', {
      body: JSON.stringify(await finish()),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });

for (const admission of ['array', 'extra'])
  test(`actual Source card retains ${admission} preview data`, async ({
    page,
    context,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
    );
    const finish = watchCompiledSourceDeps(page);
    await page.goto(
      `/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=md&shape=card&admission=${admission}`
    );
    await expect(page.getByRole('textbox')).toContainText('Fixture Document');
    const props = await page.evaluate(() =>
      window.documentMentionFixture!.componentProps()
    );
    expect(props).toMatchObject({
      previewData:
        admission === 'array'
          ? [1, 'opaque']
          : { opaque: { second: 2, first: 1 } },
    });
    await info.attach('source-actual-component-props', {
      body: JSON.stringify(props),
      contentType: 'application/json',
    });
    await info.attach('source-raw', {
      body: JSON.stringify(
        await page.evaluate(() => window.documentMentionFixture!.capture())
      ),
      contentType: 'application/json',
    });
    await info.attach('source-dependency-proof', {
      body: JSON.stringify(await finish()),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });

test('actual Source Normal Enter uses published mention selection before an earlier listener commits clear', async ({
  page,
  context,
  browserName,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/__macro_dev/gateway/**', (route) =>
    route.fulfill({ status: 403, json: { message: 'Fixture access denied' } })
  );
  const finish = watchCompiledSourceDeps(page);
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/decorator-host/document-mention-browser-test/fixture.html?kind=md&navigation=real&earlyClear=1'
  );
  await expect(page.getByRole('textbox')).toContainText('Fixture Document');
  await expect(page.locator('[data-split-targets]')).toHaveAttribute(
    'data-ready',
    'true'
  );
  await page.evaluate(() => window.documentMentionFixture!.select());
  const selected = await page.evaluate(() =>
    window.documentMentionFixture!.capture()
  );
  const handled = await page.evaluate(() =>
    window.documentMentionFixture!.enter()
  );
  expect(handled).toBe(true);
  await expect(page.locator('[data-split-targets]')).toContainText(
    '00000000-0000-7000-8000-000000000071'
  );
  const after = await page.evaluate(() =>
    window.documentMentionFixture!.capture()
  );
  const targets = await page.locator('[data-split-targets]').innerText();
  expect(after.model).toBe(selected.model);
  const capture = { selected, handled, after, targets };
  const path = resolve(
    baseline,
    browserName + '-mention-enter-navigation.json'
  );
  await info.attach('source-enter-navigation', {
    body: JSON.stringify(capture),
    contentType: 'application/json',
  });
  await info.attach('source-dependency-proof', {
    body: JSON.stringify(await finish()),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  if (process.env.DOCUMENT_MENTION_PHASE === 'before')
    writeFileSync(path, JSON.stringify(capture, null, 2));
  else expect(capture).toEqual(JSON.parse(readFileSync(path, 'utf8')));
});
