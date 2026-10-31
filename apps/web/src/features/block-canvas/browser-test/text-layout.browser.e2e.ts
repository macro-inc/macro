import {
  createScene,
  type GraphicsDocument,
  type TextFitRequest,
  translation,
} from '@macro-inc/graphics';
import { expect, type Page, test } from '@playwright/test';
import { prepareCanvasEdit } from '../../../../../../services/ai-editing-worker/src/canvas/operations';

async function fit(
  page: Page,
  document: GraphicsDocument,
  requests: TextFitRequest[]
) {
  return page.evaluate(
    async (payload) => window.measureCanvasSnapshot(payload),
    { document, requests }
  );
}
async function draw(page: Page, document: GraphicsDocument) {
  await page.evaluate(
    async (document) =>
      window.renderCanvasSnapshot({
        document,
        crop: { x: 0, y: 0, width: 1400, height: 1800 },
        scale: 1,
        revision: 'browser-layout-regression',
      }),
    document
  );
}
async function expectInside(
  page: Page,
  id: string,
  ratio = 1,
  standalone = false
) {
  const boxes = await page.locator(`[data-graphics-item="${id}"]`).evaluate(
    (element, options) => {
      const box = element.getBoundingClientRect();
      const content = element.querySelector('.canvas-lexical-text');
      if (!content) throw new Error('No rendered Canvas text');
      const ink = content.getBoundingClientRect();
      const padding = options.standalone ? 0 : 12;
      const margins = (ink: DOMRect) => ({
        left:
          ink.left -
          (box.left + (box.width * (1 - options.ratio)) / 2 + padding),
        right:
          box.right -
          (box.width * (1 - options.ratio)) / 2 -
          padding -
          ink.right,
        top:
          ink.top -
          (box.top + (box.height * (1 - options.ratio)) / 2 + padding),
        bottom:
          box.bottom -
          (box.height * (1 - options.ratio)) / 2 -
          padding -
          ink.bottom,
        height: ink.height,
      });
      const textRects: DOMRect[] = [];
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const nodeText = node.textContent;
        if (!nodeText) continue;
        // Wrapped trailing spaces can hang outside the line without painting ink.
        for (const word of nodeText.matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          textRects.push(
            ...Array.from(range.getClientRects()).filter(
              (rect) => rect.width > 0 && rect.height > 0
            )
          );
        }
      }
      return {
        ...margins(ink),
        text: textRects.map(margins),
        chips: Array.from(
          content.querySelectorAll('[data-user-mention]'),
          (chip) => margins(chip.getBoundingClientRect())
        ),
      };
    },
    { ratio, standalone }
  );
  expect(boxes.height).toBeGreaterThan(0);
  expect(boxes.text.length).toBeGreaterThan(0);
  for (const ink of [boxes, ...boxes.text, ...boxes.chips])
    for (const margin of [ink.left, ink.right, ink.top, ink.bottom])
      expect(margin).toBeGreaterThanOrEqual(-1);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/canvas-render.html');
  await page.waitForFunction(
    () => typeof window.measureCanvasSnapshot === 'function'
  );
});

test('real person chips render and fit text boxes and ellipse labels after edits and resize', async ({
  page,
}) => {
  const person = {
    userId: 'macro|alice@example.com',
    email: 'alice@example.com',
    displayName: 'Alice',
  };
  const initial = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'person-text',
      type: 'text',
      x: 20,
      y: 20,
      width: 180,
      text: 'Please review this with  today',
      fontSize: 24,
    },
    { kind: 'mentionUser', id: 'person-text', at: 24, person },
    {
      kind: 'create',
      id: 'person-ellipse',
      type: 'ellipse',
      x: 300,
      y: 20,
      width: 200,
      height: 80,
      text: 'Owner: ',
      fontSize: 24,
    },
    { kind: 'mentionUser', id: 'person-ellipse', at: 7, person },
  ]);
  const measured = await fit(page, initial, [
    { id: 'person-text', mode: 'grow' },
    { id: 'person-ellipse', mode: 'grow' },
  ]);
  await draw(page, measured.document);
  for (const id of ['person-text', 'person-ellipse']) {
    const chip = page.locator(
      `[data-graphics-item="${id}"] [data-user-mention]`
    );
    await expect(chip).toHaveText('@Alice');
    await expect(chip).toHaveAttribute('data-user-id', person.userId);
    await expect(chip).toHaveAttribute('data-email', person.email);
  }
  await expectInside(page, 'person-text', 1, true);
  await expectInside(page, 'person-ellipse', Math.SQRT1_2);
  const edited = prepareCanvasEdit(measured.document, [
    {
      kind: 'mentionUser',
      id: 'person-text',
      at: 0,
      person: {
        userId: 'macro|bob@example.com',
        email: 'bob@example.com',
        displayName: 'Bob',
      },
    },
    { kind: 'resize', id: 'person-text', width: 120, height: 40 },
    { kind: 'resize', id: 'person-ellipse', width: 150, height: 50 },
  ]);
  const fitted = await fit(page, edited, [
    { id: 'person-text', mode: 'grow' },
    { id: 'person-ellipse', mode: 'grow' },
  ]);
  await draw(page, fitted.document);
  await expect(
    page.locator('[data-graphics-item="person-text"] [data-user-mention]')
  ).toHaveText(['@Bob', '@Alice']);
  await expectInside(page, 'person-text', 1, true);
  await expectInside(page, 'person-ellipse', Math.SQRT1_2);
});

test('actual wrapped labels, unbroken strings, ellipses and standalone text fit at readable fonts', async ({
  page,
}) => {
  const text =
    'Read the full explanation before choosing the next action. '.repeat(5);
  const initial = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'rectangle',
      type: 'rectangle',
      x: 20,
      y: 20,
      width: 160,
      height: 40,
      text,
      fontSize: 22,
    },
    {
      kind: 'create',
      id: 'ellipse',
      type: 'ellipse',
      x: 240,
      y: 20,
      width: 200,
      height: 60,
      text,
      fontSize: 24,
    },
    {
      kind: 'create',
      id: 'standalone',
      type: 'text',
      x: 500,
      y: 20,
      width: 150,
      height: 20,
      text: 'unbroken'.repeat(40),
      fontSize: 26,
    },
    {
      kind: 'create',
      id: 'multiline',
      type: 'rectangle',
      x: 720,
      y: 20,
      width: 220,
      height: 40,
      text: 'First line\nSecond line\nThird line',
      fontSize: 32,
      fontFamily: 'serif',
    },
  ]);
  const measured = await fit(
    page,
    initial,
    ['rectangle', 'ellipse', 'standalone', 'multiline'].map((id) => ({ id }))
  );
  expect(
    measured.effects.every(
      (effect) =>
        !effect.overflow && effect.fontSize === effect.renderedFontSize
    )
  ).toBe(true);
  await draw(page, measured.document);
  await expectInside(page, 'rectangle');
  await expectInside(page, 'ellipse', Math.SQRT1_2);
  await expectInside(page, 'standalone', 1, true);
  await expectInside(page, 'multiline');
});

test('relabeling, a font change and a narrower width remeasure real DOM text', async ({
  page,
}) => {
  const original = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'box',
      type: 'ellipse',
      x: 30,
      y: 30,
      width: 240,
      height: 80,
      text: 'Short',
      fontSize: 20,
    },
  ]);
  const first = await fit(page, original, [{ id: 'box' }]);
  const changed = prepareCanvasEdit(first.document, [
    {
      kind: 'text',
      id: 'box',
      text: 'A much longer explanation with wrapping at the new interior width. '.repeat(
        3
      ),
    },
    { kind: 'textStyle', id: 'box', fontSize: 30, fontFamily: 'mono' },
    { kind: 'resize', id: 'box', width: 180, height: 60 },
  ]);
  const result = await fit(page, changed, [{ id: 'box' }]);
  expect(result.effects[0].renderedFontSize).toBe(30);
  expect(result.effects[0].bounds.height).toBeGreaterThan(60);
  await draw(page, result.document);
  await expectInside(page, 'box', Math.SQRT1_2);
});

test('fixed error preserves the candidate and explicit contain fits without growing geometry', async ({
  page,
}) => {
  const original = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'fixed',
      type: 'rectangle',
      x: 20,
      y: 20,
      width: 160,
      height: 80,
      text: 'Long text wrapping into many lines. '.repeat(3),
      fontSize: 24,
    },
  ]);
  const before = JSON.stringify(original);
  await expect(
    fit(page, original, [{ id: 'fixed', mode: 'error' }])
  ).rejects.toThrow('fixed interior');
  expect(JSON.stringify(original)).toBe(before);
  const contained = await fit(page, original, [
    { id: 'fixed', mode: 'contain' },
  ]);
  expect(contained.effects[0].bounds.width).toBe(160);
  expect(contained.effects[0].bounds.height).toBe(80);
  expect(contained.effects[0].renderedFontSize).toBeLessThan(24);
  await draw(page, contained.document);
  await expectInside(page, 'fixed');
});

test('tiny standalone widths grow for real glyph ink and fixed errors remain atomic', async ({
  page,
}) => {
  const initial = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'glyph',
      type: 'text',
      x: 20,
      y: 20,
      width: 1,
      height: 1000,
      text: 'W',
      fontSize: 100,
    },
  ]);
  await expect(
    fit(page, initial, [{ id: 'glyph', mode: 'error' }])
  ).rejects.toThrow('Fixed geometry');
  const grown = await fit(page, initial, [{ id: 'glyph' }]);
  expect(grown.effects[0].fontSize).toBe(100);
  expect(grown.effects[0].bounds.width).toBeGreaterThan(1);
  await draw(page, grown.document);
  await expectInside(page, 'glyph', 1, true);
  const overflow = await page
    .locator('[data-graphics-item="glyph"] .graphics-rich-text')
    .evaluate(
      (element) =>
        element.scrollWidth > element.getBoundingClientRect().width + 1
    );
  expect(overflow).toBe(false);
});

test('snapshot rendering stays read-only and never fetches referenced images', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const scene = createScene([
    {
      id: 'private-image',
      type: 'image',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(20, 20),
      appearance: { fill: 'transparent', stroke: '#000000' },
      geometry: {
        width: 240,
        height: 160,
        name: 'Permission-scoped reference',
        source: { type: 'url', url: 'https://private.example.com/secret.png' },
      },
    },
  ]);
  const frozen = JSON.stringify(scene);
  await draw(page, scene);
  await expect(
    page.getByText('Image unavailable: Permission-scoped reference')
  ).toBeVisible();
  expect(requests.some((url) => url.includes('private.example.com'))).toBe(
    false
  );
  expect(JSON.stringify(scene)).toBe(frozen);
  await expect(
    page.locator(
      '[data-presence-cursor], [data-presence-preview], [contenteditable=true]'
    )
  ).toHaveCount(0);
});

test('a reused render page releases one scene before measuring and drawing another', async ({
  page,
}) => {
  const first = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'private-first-label',
      type: 'rectangle',
      x: 20,
      y: 20,
      text: 'First authorized scene',
      fontSize: 22,
    },
  ]);
  const measured = await fit(page, first, [{ id: 'private-first-label' }]);
  await draw(page, measured.document);
  await expect(page.locator('[data-graphics-item]')).toHaveCount(1);
  await page.evaluate(() => window.resetCanvasSnapshot());
  await expect(page.locator('#root')).toBeEmpty();
  expect(await page.evaluate(() => window.readCanvasTextLayout())).toEqual([]);
  await page.evaluate(() => window.prepareCanvasRender());
  const second = prepareCanvasEdit(createScene(), [
    {
      kind: 'create',
      id: 'second-label',
      type: 'ellipse',
      x: 20,
      y: 20,
      width: 200,
      text: 'Second scene has independent wrapped text at readable font size.',
      fontSize: 26,
    },
  ]);
  const next = await fit(page, second, [{ id: 'second-label' }]);
  await draw(page, next.document);
  await expect(page.locator('[data-graphics-item]')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText(
    'First authorized scene'
  );
  await expectInside(page, 'second-label', Math.SQRT1_2);
  await page.evaluate(() => window.resetCanvasSnapshot());
});
