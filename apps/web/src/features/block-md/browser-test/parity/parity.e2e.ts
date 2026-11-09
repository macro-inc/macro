import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

function configured(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name}; parity never skips missing configuration`);
  return value;
}
function local(value: string) {
  const host = new URL(value).hostname;
  return (
    ['localhost', '127.0.0.1', '127.0.0.2'].includes(host) ||
    host === process.env.EDITOR_PARITY_LOCAL_HOST ||
    host.endsWith('.localhost')
  );
}
const body = (page: Page) =>
  page.getByRole('textbox', { name: 'Document content', exact: true });

// These are the same real keyboard interactions for both engines. No source
// injection, editor state replacement, or mocked app modules are permitted.
type Scenario = {
  name: string;
  text: string;
  key?: string;
  undo?: boolean;
  reload?: boolean;
  menu?: boolean;
  action?:
    | 'title'
    | 'tags'
    | 'properties'
    | 'table'
    | 'check'
    | 'comment'
    | 'drag'
    | 'collaboration';
  paste?: { text: string; html?: string; file?: 'text' | 'image' };
};
const scenarios: Scenario[] = [
  { name: 'empty', text: '' },
  { name: 'title', text: '', action: 'title' },
  { name: 'tags', text: '', action: 'tags', menu: true },
  { name: 'properties', text: '', action: 'properties', menu: true },
  { name: 'heading1', text: '# Test' },
  { name: 'heading2', text: '## Test' },
  { name: 'heading-enter', text: '# title', key: 'Enter' },
  { name: 'bullet', text: '- Test' },
  { name: 'number', text: '1. Test' },
  { name: 'quote', text: '> Test' },
  { name: 'code', text: '```\nconst value = 1;' },
  { name: 'checklist', text: '[] Test' },
  { name: 'divider', text: '---\n' },
  { name: 'bold', text: '**bold** ' },
  { name: 'italic', text: '_italic_ ' },
  { name: 'inline-code', text: '`code` ' },
  { name: 'strike', text: '~~strike~~ ' },
  { name: 'slash', text: '/', menu: true },
  { name: 'mention', text: '@', menu: true },
  { name: 'snippet', text: ';', menu: true },
  { name: 'link', text: 'https://example.com ' },
  { name: 'nested-list', text: '- Parent\nChild', key: 'Tab' },
  { name: 'paste-text', text: '', paste: { text: 'Pasted plain text' } },
  {
    name: 'paste-markdown',
    text: '',
    paste: { text: '# Pasted heading\n\n**bold**' },
  },
  {
    name: 'paste-html',
    text: '',
    paste: {
      text: 'Pasted heading',
      html: '<h2>Pasted heading</h2><p><strong>bold</strong></p>',
    },
  },
  { name: 'paste-file', text: '', paste: { text: '', file: 'text' } },
  { name: 'paste-image', text: '', paste: { text: '', file: 'image' } },
  { name: 'table', text: '/table', action: 'table' },
  { name: 'toggle-checklist', text: '[] Check item', action: 'check' },
  { name: 'comment', text: 'Comment anchor', action: 'comment' },
  { name: 'drag-block', text: 'First block\nSecond block', action: 'drag' },
  {
    name: 'two-tab-collaboration',
    text: 'Collaborative text',
    action: 'collaboration',
  },
  { name: 'undo-redo', text: 'Persistence marker', undo: true },
  { name: 'reload', text: 'Reload persistence marker', reload: true },
];

async function reset(page: Page) {
  const title = page
    .locator('[data-block-content] [contenteditable="true"]')
    .first();
  await title.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  // Backspace in an already empty legacy body intentionally focuses the title.
  // Return to the body before either engine receives the scripted input.
  await body(page).click();
  await expect(body(page)).toBeFocused();
}

async function markdown(page: Page) {
  // Use the application's real copy action, exercising its engine adapter.
  const trigger = page
    .locator('button[aria-haspopup="true"]:not([aria-label])')
    .filter({ has: page.locator('svg[data-macro-icon="dots-three"]') })
    .first();
  await page.evaluate(() =>
    navigator.clipboard.writeText('parity export has not run')
  );
  await trigger.click();
  await page
    .getByRole('menuitem', { name: 'Copy as markdown', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .not.toBe('parity export has not run');
  const result = await page.evaluate(() => navigator.clipboard.readText());
  expect(result).not.toBe('parity export has not run');
  return result;
}

async function dom(page: Page) {
  return page.locator('[data-block-content]').evaluate((root) => {
    // Attribute and CSS declaration ordering is not DOM structure. Retain every
    // value, node, style and text; the reviewed exception allowlist is empty.
    function tree(node: Node): unknown {
      if (node instanceof Element) {
        const attributes = [...node.attributes]
          .map((attribute) => {
            if (
              attribute.name === 'style' &&
              (node instanceof HTMLElement || node instanceof SVGElement)
            ) {
              const declarations = [...node.style]
                .sort()
                .map((name) => [
                  name,
                  node.style.getPropertyValue(name),
                  node.style.getPropertyPriority(name),
                ]);
              return [attribute.namespaceURI, attribute.name, declarations];
            }
            return [attribute.namespaceURI, attribute.name, attribute.value];
          })
          .sort((a, b) =>
            JSON.stringify(a.slice(0, 2)).localeCompare(
              JSON.stringify(b.slice(0, 2))
            )
          );
        return {
          namespace: node.namespaceURI,
          tag: node.tagName,
          attributes,
          children: [...node.childNodes].map(tree),
        };
      }
      return { type: node.nodeType, text: node.textContent };
    }
    const overlays = [...document.querySelectorAll('.menu-surface')]
      .filter(
        (element) =>
          !root.contains(element) && element.getClientRects().length > 0
      )
      .map(tree);
    return JSON.stringify({ document: tree(root), overlays }, null, 2);
  });
}

for (const scenario of scenarios) {
  test(scenario.name, async ({ browser }, info) => {
    const evidence: Record<
      string,
      {
        dom: string;
        accessibility: string;
        markdown: string;
        screenshot: Buffer;
      }
    > = {};
    for (const flag of ['OFF', 'ON']) {
      const url = configured(`EDITOR_PARITY_${flag}_URL`);
      if (!local(url))
        throw new Error('Parity requires isolated local frontends');
      const documentId = configured(`EDITOR_PARITY_${flag}_DOCUMENT_ID`);
      const context = await browser.newContext({
        storageState: configured('EDITOR_PARITY_AUTH'),
        ignoreHTTPSErrors: true,
        permissions: ['clipboard-read', 'clipboard-write'],
        viewport: { width: 1440, height: 1100 },
      });
      await context.route('**/*', (route) =>
        local(route.request().url()) ? route.continue() : route.abort()
      );
      await context.routeWebSocket(
        (url) => !local(String(url)),
        (socket) => socket.close()
      );
      context.setDefaultTimeout(15000);
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      try {
        console.log(`${flag}: navigate`);
        await page.goto(
          `${url.replace(/\/$/, '').replace(/\/app$/, '')}/app/drive/md/${encodeURIComponent(documentId)}`
        );
        await expect(body(page)).toBeVisible({ timeout: 90_000 });
        const previousUrl = page.url();
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page
          .getByRole('button', { name: 'Create Document', exact: true })
          .click();
        await expect(page).toHaveURL(
          (url) =>
            /^\/app\/drive\/md\/[^/]+$/.test(url.pathname) &&
            url.href !== previousUrl,
          { timeout: 90_000 }
        );
        await writeFile(
          info.outputPath(`${flag}-created-document.json`),
          JSON.stringify({ url: page.url() })
        );
        console.log(`${flag}: document body`);
        await expect(body(page)).toBeVisible({ timeout: 90_000 });
        await expect(body(page)).toHaveAttribute('contenteditable', 'true');
        console.log(`${flag}: readiness`);
        await expect(
          page.locator('[data-block-content] .skeleton-shimmer')
        ).toHaveCount(0, { timeout: 90000 });
        console.log(`${flag}: interact`);
        await reset(page);
        await body(page).pressSequentially(scenario.text);
        if (scenario.name === 'heading1')
          await expect.soft(body(page).locator('h1')).toHaveText('Test');
        if (scenario.name === 'heading2')
          await expect.soft(body(page).locator('h2')).toHaveText('Test');
        if (scenario.key) await page.keyboard.press(scenario.key);
        if (scenario.name === 'heading-enter') {
          await expect(body(page).locator(':scope > h1')).toHaveText('title');
          await expect(body(page).locator(':scope > p')).toHaveCount(1);
        }
        if (scenario.undo) {
          await page.keyboard.press('ControlOrMeta+Z');
          await page.keyboard.press('ControlOrMeta+Shift+Z');
        }
        if (scenario.reload) {
          await page.reload();
          await expect(body(page)).toBeVisible({ timeout: 90_000 });
          await expect(body(page)).toContainText(scenario.text, {
            timeout: 30_000,
          });
        }
        if (scenario.paste) {
          await body(page).evaluate((element, payload) => {
            const transfer = new DataTransfer();
            transfer.setData('text/plain', payload.text);
            if (payload.html) transfer.setData('text/html', payload.html);
            if (payload.file === 'text')
              transfer.items.add(
                new File(['Local parity fixture'], 'parity.txt', {
                  type: 'text/plain',
                })
              );
            if (payload.file === 'image') {
              const bytes = Uint8Array.from(
                atob(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
                ),
                (c) => c.charCodeAt(0)
              );
              transfer.items.add(
                new File([bytes], 'parity.png', { type: 'image/png' })
              );
            }
            element.dispatchEvent(
              new ClipboardEvent('paste', {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            );
          }, scenario.paste);
        }
        if (scenario.paste?.file === 'text')
          await expect(body(page)).toContainText('parity.txt');
        else if (scenario.paste?.file === 'image')
          await expect(body(page).locator('img')).toBeVisible();
        else if (scenario.paste?.html)
          await expect(body(page).locator('h2')).toHaveText('Pasted heading');
        else if (scenario.paste)
          await expect(body(page)).toContainText('Pasted');
        if (scenario.action === 'title') {
          const title = page
            .locator('[data-block-content] [contenteditable="true"]')
            .first();
          await title.click();
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.type('Parity document');
          await page.keyboard.press('Tab');
          await expect(body(page)).toBeFocused();
        }
        if (scenario.action === 'tags')
          await page
            .getByRole('button', { name: 'Add tags', exact: true })
            .click();
        if (scenario.action === 'properties')
          await page
            .getByRole('button', { name: 'Add property', exact: true })
            .click();
        if (scenario.action === 'table') {
          await page
            .locator('.menu-surface:visible')
            .getByText('Table', { exact: true })
            .click();
          await expect(
            page.locator('.menu-surface:visible .grid')
          ).toBeVisible();
          await page.keyboard.press('Enter');
          await expect(body(page).locator('table')).toBeVisible();
          await page.keyboard.type('Table cell');
          await page.keyboard.press('Tab');
          await page.keyboard.type('Second cell');
        }
        if (scenario.action === 'check') {
          const checkbox = body(page).getByRole('checkbox');
          const point = await checkbox.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const marker = getComputedStyle(element, '::before');
            return {
              x:
                rect.left +
                parseFloat(marker.left) +
                parseFloat(marker.width) / 2,
              y:
                rect.top +
                parseFloat(marker.top) +
                parseFloat(marker.height) / 2,
            };
          });
          await page.mouse.click(point.x, point.y);
          await expect(body(page).getByRole('checkbox')).toBeChecked();
        }
        if (scenario.action === 'comment') {
          await page.keyboard.press('Home');
          await page.keyboard.press('Shift+End');
          await page
            .getByRole('button', { name: 'Comment', exact: true })
            .click();
          await expect(
            page
              .getByRole('textbox', { name: 'Leave a comment...', exact: true })
              .last()
          ).toBeVisible();
          await page
            .getByRole('textbox', { name: 'Leave a comment...', exact: true })
            .last()
            .fill('Parity comment');
          await page
            .getByRole('button', { name: 'Send message', exact: true })
            .last()
            .click();
          await expect(
            page.getByText('Parity comment', { exact: true }).last()
          ).toBeVisible();
        }
        if (scenario.action === 'drag') {
          const blocks = body(page).locator(':scope > p');
          await blocks.first().hover();
          const handle = page
            .locator('[draggable="true"]')
            .filter({ visible: true })
            .last();
          await handle.dragTo(blocks.last());
        }
        if (scenario.action === 'collaboration') {
          const reader = await browser.newContext({
            storageState: await context.storageState(),
            ignoreHTTPSErrors: true,
          });
          await reader.route('**/*', (route) =>
            local(route.request().url()) ? route.continue() : route.abort()
          );
          await reader.routeWebSocket(
            (url) => !local(String(url)),
            (socket) => socket.close()
          );
          try {
            const second = await reader.newPage();
            await second.goto(page.url());
            await expect(body(second)).toContainText(scenario.text, {
              timeout: 30000,
            });
            await page.keyboard.type(' + remote edit');
            await expect(body(second)).toContainText(' + remote edit', {
              timeout: 30000,
            });
          } finally {
            await reader.close();
          }
        }
        if (scenario.menu)
          await expect(
            page
              .locator(
                '[role="menu"]:visible, [role="listbox"]:visible, [role="dialog"]:visible, .menu-surface:visible'
              )
              .first()
          ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await writeFile(
          info.outputPath(`${flag}-styles.json`),
          JSON.stringify(
            await page.evaluate(() => {
              const selectors = [
                '[aria-label="Add tags"]',
                '[data-block-content] [contenteditable="true"]',
                '[data-block-content]',
              ];
              return selectors.map((selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement))
                  return { selector, missing: true };
                const style = getComputedStyle(element);
                return {
                  selector,
                  rect: element.getBoundingClientRect().toJSON(),
                  background: style.backgroundColor,
                  color: style.color,
                  border: style.borderColor,
                  shadow: style.boxShadow,
                  font: style.font,
                  fontFamily: style.fontFamily,
                  fontWeight: style.fontWeight,
                  filter: style.filter,
                  backdropFilter: style.backdropFilter,
                  variables: {
                    face: style.getPropertyValue('--button-secondary-face'),
                    background: style.getPropertyValue('--button-secondary-bg'),
                    outline: style.getPropertyValue(
                      '--button-elevated-outline'
                    ),
                  },
                };
              });
            }),
            null,
            2
          )
        );
        console.log(`${flag}: capture`);
        const domSelection = await body(page).evaluate((root) => {
          const selection = window.getSelection();
          function path(node: Node | null): number[] | null {
            const result: number[] = [];
            while (node && node !== root) {
              const parent = node.parentNode;
              if (!parent) return null;
              result.unshift(
                [...parent.childNodes].findIndex((child) => child === node)
              );
              node = parent;
            }
            return node === root ? result : null;
          }
          return selection
            ? {
                collapsed: selection.isCollapsed,
                anchor: {
                  path: path(selection.anchorNode),
                  offset: selection.anchorOffset,
                },
                focus: {
                  path: path(selection.focusNode),
                  offset: selection.focusOffset,
                },
              }
            : null;
        });
        await writeFile(
          info.outputPath(`${flag}-dom-selection.json`),
          JSON.stringify(domSelection, null, 2)
        );
        const screenshot = await page
          .locator('[data-block-content]')
          .screenshot({ animations: 'disabled', caret: 'hide' });
        const structure = await dom(page);
        const accessibilitySession = await context.newCDPSession(page);
        try {
          const tree = await accessibilitySession.send(
            'Accessibility.getFullAXTree'
          );
          await writeFile(
            info.outputPath(`${flag}-full-accessibility.json`),
            JSON.stringify(tree, null, 2)
          );
        } finally {
          await accessibilitySession.detach();
        }
        const accessibility = await page
          .locator('[data-block-content]')
          .ariaSnapshot();
        await writeFile(info.outputPath(`${flag}-dom.json`), structure);
        await writeFile(info.outputPath(`${flag}.png`), screenshot);
        await page.keyboard.press('Escape');
        const output = {
          dom: structure,
          accessibility,
          markdown: await markdown(page),
          screenshot,
        };
        evidence[flag] = output;
        await writeFile(info.outputPath(`${flag}-dom.json`), output.dom);
        await writeFile(info.outputPath(`${flag}.md`), output.markdown);
        await writeFile(
          info.outputPath(`${flag}-accessibility.yml`),
          output.accessibility
        );
        await writeFile(info.outputPath(`${flag}.png`), output.screenshot);
      } catch (error) {
        await info.attach(`${flag}-failure`, {
          body: String(error),
          contentType: 'text/plain',
        });
        expect.soft(error, `${flag} interaction failed`).toBeUndefined();
      } finally {
        await context.tracing.stop({
          path: info.outputPath(`${flag}-trace.zip`),
        });
        await context.close();
      }
    }
    const comparisons = {
      pixels: 'blocked',
      accessibility: 'blocked',
      markdown: 'blocked',
      savedJson: 'blocked',
      dom: 'blocked',
    };
    async function sidecar() {
      const artifacts: Record<string, { path: string; sha256: string }> = {};
      for (const flag of ['OFF', 'ON']) {
        for (const suffix of [
          '-dom.json',
          '-dom-selection.json',
          '.md',
          '-accessibility.yml',
          '-full-accessibility.json',
          '.png',
        ]) {
          const path = info.outputPath(`${flag}${suffix}`);
          try {
            const bytes = await readFile(path);
            artifacts[`${flag}${suffix}`] = {
              path,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            };
          } catch {
            // An interrupted interaction leaves this comparison blocked.
          }
        }
      }
      await writeFile(
        info.outputPath('parity-case.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            surface: 'document',
            case: scenario.name,
            provenance: { engine: 'native' },
            comparisons,
            result: Object.values(comparisons).includes('fail')
              ? 'fail'
              : 'blocked',
            blockedReasons: [
              'Production compatibility engine and source fingerprint are not attached.',
              'Production getSaveState/public savedState reader evidence is unavailable.',
              'ariaSnapshot is diagnostic; full accessibility-tree parity is pending.',
            ],
            artifacts,
          },
          null,
          2
        )
      );
    }
    if (!evidence.ON || !evidence.OFF) {
      await sidecar();
      return;
    }
    comparisons.dom = evidence.ON.dom === evidence.OFF.dom ? 'pass' : 'fail';
    comparisons.markdown =
      evidence.ON.markdown === evidence.OFF.markdown ? 'pass' : 'fail';
    expect
      .soft(evidence.ON.dom, 'Document DOM differs')
      .toEqual(evidence.OFF.dom);
    expect
      .soft(evidence.ON.accessibility, 'Accessibility tree differs')
      .toEqual(evidence.OFF.accessibility);
    expect
      .soft(evidence.ON.markdown, 'Exported markdown differs')
      .toEqual(evidence.OFF.markdown);
    // Compare decoded screenshot pixels with Playwright's zero-tolerance
    // matcher; compression metadata is not a visible difference.
    const snapshot = info.snapshotPath(`${scenario.name}.png`);
    await mkdir(dirname(snapshot), { recursive: true });
    await writeFile(snapshot, evidence.OFF.screenshot);
    const errorsBeforeScreenshot = info.errors.length;
    expect
      .soft(evidence.ON.screenshot)
      .toMatchSnapshot(`${scenario.name}.png`, {
        maxDiffPixels: 0,
        threshold: 0,
      });
    comparisons.pixels =
      info.errors.length === errorsBeforeScreenshot ? 'pass' : 'fail';
    await sidecar();
    expect
      .soft(
        false,
        'Parity is blocked until production compatibility, saved JSON, and full accessibility evidence are attached'
      )
      .toBe(true);
  });
}
