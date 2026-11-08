import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    imeFixture: {
      selectEnd(): void;
      remote(): void;
      advance(ms: number): void;
      flush(): void;
      result(): {
        model: string;
        mirror: string;
        remote: string;
        events: string[];
        errors: string[];
        sentUpdates: number;
      };
    };
    fixture: {
      render: {
        expandingDecorator(expanded: boolean): void;
        createImage(): void;
        updateImage(): void;
        removeImage(): void;
        createSlot(): void;
        recreateSlot(): void;
        stats: { mounts: number; unmounts: number };
      };
      drag(): {
        events: string[];
        keys: readonly number[];
        payload: string;
        caret: boolean;
      };
      capturedMimes: { mime: string; value: string }[];
      second(nested: boolean, state?: string): Promise<void>;
      highlights(): Promise<void>;
      disposeFirstHighlight(): void;
      closeSecond(): Promise<void>;
      pasteCustom(): Promise<boolean>;
      presence(visible: boolean): void;
      pasteHTML(html: string): Promise<boolean>;
      reset(text: string): void;
      selectEnd(): void;
      text(): string;
      mirrorText(): string;
      undo(): void;
      redo(): void;
      errors: string[];
      count(): void;
      crossings: string[];
      metrics: {
        calls: number;
        nodeCalls: number;
        selectionWrites: number;
        textWrites: number;
      };
      setState(json: string): void;
    };
  }
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) =>
    console.error('Browser exception:', error.message)
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error('Browser console:', message.text());
  });
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.evaluate(() => window.fixture.selectEnd());
});
test('100 DOM-first characters have one crossing each, zero echo writes and matching mirrors', async ({
  page,
}) => {
  await page.keyboard.type('x'); // Warm the history availability notification.
  await page.evaluate(() => window.fixture.count());
  await page.keyboard.type('x'.repeat(100));
  const actual = await page.evaluate(() => {
    const metrics = { ...window.fixture.metrics };
    return {
      model: window.fixture.text(),
      mirror: window.fixture.mirrorText(),
      metrics,
      errors: window.fixture.errors,
      crossings: [...window.fixture.crossings],
    };
  });
  expect(actual.model).toBe('a' + 'x'.repeat(101));
  expect(actual.mirror).toBe(actual.model);
  expect(actual.metrics, JSON.stringify(actual.crossings)).toEqual({
    calls: 100,
    nodeCalls: 0,
    selectionWrites: 0,
    textWrites: 0,
  });
  expect(actual.errors).toEqual([]);
});
test('typing, undo and redo preserve text', async ({ page }) => {
  await page.keyboard.type(' hello');
  await page.evaluate(() => window.fixture.undo());
  await expect.poll(() => page.evaluate(() => window.fixture.text())).toBe('a');
  await page.evaluate(() => window.fixture.redo());
  await expect(page.locator('#editor')).toHaveText('a hello');
});
test('word delete supplies the browser target range', async ({ page }) => {
  await page.evaluate(() => {
    window.fixture.reset('first second');
    window.fixture.selectEnd();
  });
  await page.keyboard.press('Control+Backspace');
  await expect(page.locator('#editor')).toHaveText('first ');
  expect(await page.evaluate(() => window.fixture.mirrorText())).toBe('first ');
});
test('HTML paste imports serialized drafts and preserves inline formatting', async ({
  page,
}) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData(
      'text/html',
      '<p><strong>bold</strong> <a href="https://example.com">link</a></p>'
    );
    transfer.setData('text/plain', 'bold link');
    document.getElementById('editor')?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      })
    );
  });
  await expect(page.locator('#editor a')).toHaveText('link');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('native IME composition commits the displayed text', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', {
    text: '漢',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await client.send('Input.insertText', { text: '漢字' });
  await expect(page.locator('#editor')).toHaveText('a漢字');
  expect(await page.evaluate(() => window.fixture.mirrorText())).toBe('a漢字');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
  await client.detach();
});

test('line deletion uses the supplied target range', async ({ page }) => {
  await page.evaluate(() => {
    window.fixture.reset('first second');
    window.fixture.selectEnd();
    const dom = document.getSelection()?.anchorNode;
    if (!dom) throw new Error('Missing text');
    const range = new StaticRange({
      startContainer: dom,
      startOffset: 0,
      endContainer: dom,
      endOffset: 12,
    });
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteSoftLineBackward',
    });
    event.getTargetRanges = () => [range];
    document.getElementById('editor')?.dispatchEvent(event);
  });
  await expect(page.locator('#editor')).toHaveText('');
  expect(await page.evaluate(() => window.fixture.text())).toBe('');
});

test('lists, tables, links, stored code highlights and marks render from real WASM', async ({
  page,
}, info) => {
  const { richState } = await import('./states');
  await page.evaluate(
    (state) => window.fixture.setState(JSON.stringify(state)),
    richState
  );
  await expect(page.locator('#editor h2')).toHaveText('Heading');
  await expect(page.locator('#editor blockquote')).toHaveText('Quote');
  await expect(page.locator('#editor ul li')).toHaveText(['One', 'Two']);
  await expect(page.locator('#editor td')).toHaveText('A');
  await expect(page.locator('#editor th')).toHaveText('B');
  await expect(page.locator('#editor col')).toHaveCount(2);
  await expect(page.locator('#editor col').first()).toHaveCSS('width', '120px');
  await expect(page.locator('#editor a')).toHaveAttribute(
    'href',
    'https://example.com'
  );
  await expect(page.locator('#editor mark')).toHaveText('Marked');
  await expect(page.locator('#editor code')).toHaveText('const n = 1;');
  await expect(
    page.locator('#editor p span').filter({ hasText: /^Bold$/ })
  ).toHaveCSS('font-weight', '700');
  expect(
    await page
      .locator('#editor h2')
      .evaluate((element) => element.style.contentVisibility)
  ).toBe('auto');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
  await page.screenshot({ path: info.outputPath('rich.png') });
});

test('Solid decorators retain identity by key and reserve stored height on first paint', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.fixture.render.createImage();
    const before = document.querySelector('[data-lexical-key="1000000"]');
    const height = before instanceof HTMLElement ? before.style.height : '';
    window.fixture.render.updateImage();
    const after = document.querySelector('[data-lexical-key="1000000"]');
    return {
      same: before === after,
      text: after?.textContent,
      height,
      stats: { ...window.fixture.render.stats },
    };
  });
  expect(result).toEqual({
    same: true,
    text: 'second',
    height: '240px',
    stats: { mounts: 1, unmounts: 0 },
  });
  await page.evaluate(() => window.fixture.render.removeImage());
  expect(await page.evaluate(() => window.fixture.render.stats)).toEqual({
    mounts: 1,
    unmounts: 1,
  });
  await expect(page.locator('[data-lexical-key="1000000"]')).toHaveCount(0);
});
test('recreated elements move keyed children into the new managed slot', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.fixture.render.createSlot();
    const previous = document.querySelector('[data-lexical-key="1000002"]');
    const before = document.querySelector(
      '[data-lexical-key="1000001"]'
    )?.textContent;
    window.fixture.render.recreateSlot();
    const next = document.querySelector('[data-lexical-key="1000002"]');
    const parent = document.querySelector('[data-lexical-key="1000001"]');
    return {
      same: previous === next,
      before,
      after: parent?.textContent,
      tag: parent?.tagName,
    };
  });
  expect(result).toEqual({
    same: true,
    before: 'beforechildafter',
    after: 'beforechildafter',
    tag: 'ASIDE',
  });
});

test('decorator DOM recreation preserves the Solid component and reactive updates', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.fixture.render.expandingDecorator(false);
    const old = document.querySelector('[data-lexical-key="1000003"]');
    const host = old?.firstChild;
    window.fixture.render.expandingDecorator(true);
    const next = document.querySelector('[data-lexical-key="1000003"]');
    return {
      tag: next?.tagName,
      replaced: old !== next,
      sameHost: host === next?.firstChild,
      text: next?.textContent,
      stats: { ...window.fixture.render.stats },
    };
  });
  expect(result).toEqual({
    tag: 'DIV',
    replaced: true,
    sameHost: true,
    text: 'second',
    stats: { mounts: 1, unmounts: 0 },
  });
});

test('long native CJK composition holds remote paint but keeps sync live and converges at the cap', async ({
  page,
}) => {
  await page.goto('/browser-test/ime.html');
  const editor = page.locator('#editor');
  await expect(editor).toHaveText('a');
  await page.evaluate(() => window.imeFixture.selectEnd());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    text: '漢',
    selectionStart: 1,
    selectionEnd: 1,
  });
  await expect(editor).toHaveText('a漢');
  await page.evaluate(() => window.imeFixture.remote());
  await expect(editor).toHaveText('a漢');
  await cdp.send('Input.imeSetComposition', {
    text: '漢字入力',
    selectionStart: 4,
    selectionEnd: 4,
  });
  await expect(editor).toHaveText('a漢字入力');
  await page.evaluate(() => {
    window.imeFixture.advance(2000);
    window.imeFixture.flush();
  });
  const held = await page.evaluate(() => window.imeFixture.result());
  expect(held.remote).toBe('遠a漢字入力');
  expect(held.model).toBe('a漢字入力');
  expect(held.sentUpdates).toBeGreaterThan(0);
  await page.evaluate(() => window.imeFixture.advance(3000));
  await expect(editor).toHaveText('遠a漢字入力');
  const result = await page.evaluate(() => window.imeFixture.result());
  expect(result.model).toBe(result.remote);
  expect(result.mirror).toBe(result.model);
  expect(result.events).toContain('editor.composition.hold.cap');
  expect(result.events).toContain('end-before-paint:a漢字入力');
  expect(result.errors).toEqual([]);
  await page.keyboard.type('!');
  await page.evaluate(() => window.imeFixture.flush());
  expect(await page.evaluate(() => window.imeFixture.result().model)).toBe(
    '遠a漢字入力!'
  );
});

test('remote cursor overlays paint after apply without moving local selection', async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.presence(true));
  await expect(
    page.locator('[data-remote-cursor="fixture-peer"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-remote-selection="fixture-peer"]')
  ).toBeVisible();
  expect(await page.evaluate(() => document.getSelection()?.anchorOffset)).toBe(
    1
  );
  await page.evaluate(() => window.fixture.presence(false));
  await expect(page.locator('[data-remote-cursor="fixture-peer"]')).toHaveCount(
    0
  );
  expect(await page.evaluate(() => window.fixture.text())).toBe('a');
});

test('nested theme classes style headings, text and stored code tokens', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { richState } = await import('./states');
    window.fixture.setState(JSON.stringify(richState));
  });
  await expect(page.locator('#editor h2')).toHaveClass('theme-h2');
  await expect(page.locator('#editor .theme-bold')).toHaveText('Bold');
  await expect(page.locator('#editor .theme-keyword')).toHaveText('const');
});

test('lazy HTML paste cannot write into a changed selection or document', async ({
  page,
}) => {
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loading = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(/\/src\/view\/html-import\.ts(?:\?|$)/, async (route) => {
    requested();
    await held;
    await route.continue();
  });
  const paste = page.evaluate(() =>
    window.fixture.pasteHTML('<p>stale paste</p>')
  );
  await loading;
  await page.keyboard.type('x');
  release();
  expect(await paste).toBe(false);
  expect(await page.evaluate(() => window.fixture.text())).toBe('ax');
});

test('structural DOM mutations restore keyed nodes without a model crossing', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fixture.count();
    const root = document.getElementById('editor');
    const paragraph = root?.querySelector('p');
    if (!root || !paragraph) throw new Error('Missing mutation fixture');
    paragraph.remove();
    root.append(document.createTextNode('foreign'));
    paragraph.querySelector('[data-lexical-text]')?.firstChild?.remove();
  });
  await expect(page.locator('#editor')).toHaveText('a');
  const result = await page.evaluate(() => ({
    text: window.fixture.mirrorText(),
    calls: window.fixture.metrics.calls,
    errors: window.fixture.errors,
  }));
  expect(result).toEqual({ text: 'a', calls: 0, errors: [] });
});

test('paste forwards every MIME entry to the session', async ({ page }) => {
  expect(await page.evaluate(() => window.fixture.pasteCustom())).toBe(true);
  expect(
    await page.evaluate(() => window.fixture.capturedMimes)
  ).toContainEqual({
    mime: 'application/x-view-fixture',
    value: 'custom-payload',
  });
  await expect(page.locator('#editor')).toHaveText('ax');
});

test('a nested editor owns selection and input without parent model calls', async ({
  page,
}) => {
  await page.evaluate(() => window.fixture.second(true));
  await page.evaluate(() => window.fixture.count());
  await page.keyboard.type('x');
  await expect(page.locator('[data-second-editor]')).toHaveText('nx');
  expect(await page.evaluate(() => window.fixture.metrics.calls)).toBe(0);
  expect(await page.evaluate(() => window.fixture.text())).toBe('a');
  await page.evaluate(() => window.fixture.closeSecond());
});

test('highlight owners sharing a namespace retain each other ranges on disposal', async ({
  page,
}) => {
  const { richState } = await import('./states');
  await page.evaluate(async (state) => {
    window.fixture.setState(JSON.stringify(state));
    await window.fixture.second(false, JSON.stringify(state));
    await window.fixture.highlights();
  }, richState);
  await expect(page.locator('#editor code[data-line-count]')).toHaveCount(1);
  await expect(
    page.locator('[data-second-editor] code[data-line-count]')
  ).toHaveCount(1);
  expect(
    await page.evaluate(() => CSS.highlights.get('code-fixture-keyword')?.size)
  ).toBe(2);
  await page.evaluate(() => window.fixture.disposeFirstHighlight());
  expect(
    await page.evaluate(() => CSS.highlights.get('code-fixture-keyword')?.size)
  ).toBe(1);
  await page.evaluate(() => window.fixture.closeSecond());
  expect(
    await page.evaluate(() => CSS.highlights.has('code-fixture-keyword'))
  ).toBe(false);
});

test('drag lifecycle carries internal keys to the application move handler', async ({
  page,
}) => {
  const drag = await page.evaluate(() => window.fixture.drag());
  expect(drag.events).toEqual(['start', 'over', 'internal', 'end']);
  expect(drag.keys).toHaveLength(1);
  expect(JSON.parse(drag.payload).keys).toEqual(drag.keys);
  expect(drag.caret).toBe(false);
  expect(await page.evaluate(() => window.fixture.text())).toBe('a');
});
