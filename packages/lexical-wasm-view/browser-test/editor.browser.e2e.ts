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
      commitWork(size: number): Promise<{
        replacementLast: number | undefined;
        replacementActual: number;
        rebound: boolean;
        reboundTop: number | undefined;
        reboundActual: number;
        size: number;
        commentReads: number;
        commentTop: number | undefined;
        actualTop: number;
        tableWrites: number;
        selectionIntact: boolean;
        codeRangeInputs: number;
        retained: boolean;
        shiftedReads: number;
        movedLast: number | undefined;
        actualLast: number;
        empty: boolean | null;
      }>;
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
      unhandledKeyFallback(): number;
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
  expect(
    await page
      .locator('#editor col')
      .evaluateAll((columns) => columns.map((column) => column.style.width))
  ).toEqual(['120px', '180px']);
  // WebKit does not expose a rendered box for col elements; cells carry column geometry.
  expect(
    await page
      .locator('#editor td, #editor th')
      .evaluateAll((cells) =>
        cells.map((cell) => cell.getBoundingClientRect().width)
      )
  ).toEqual([120, 180]);
  await expect(page.locator('#editor a')).toHaveAttribute(
    'href',
    'https://example.com'
  );
  await expect(page.locator('#editor mark')).toHaveText('Marked');
  await expect(page.locator('#editor code')).toHaveText('const n = 1;');
  await expect(
    page.locator('#editor p strong').filter({ hasText: /^Bold$/ })
  ).toHaveCSS('font-weight', '700');
  expect(
    await page
      .locator('#editor h2')
      .evaluate((element) => element.style.contentVisibility)
  ).toBe('');
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

test('stored links follow upstream protocol filtering and formatted text keeps nested semantics', async ({
  page,
}) => {
  await page.evaluate(() => {
    const text = (value: string, format = 0) => ({
      type: 'text',
      version: 1,
      text: value,
      format,
      detail: 0,
      mode: 'normal',
      style: '',
    });
    const urls = [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'ftp://example.com',
      'javascript:alert(1)',
      'https://example.com',
      'mailto:user@example.com',
      'example.com',
    ];
    window.fixture.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [
                ...urls.map((url) => ({
                  type: 'link',
                  version: 1,
                  url,
                  children: [text(url)],
                })),
                text('nested', 17),
              ],
            },
          ],
        },
      })
    );
  });
  const links = page.locator('#editor a');
  await expect(links).toHaveCount(7);
  expect(
    await links.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href'))
    )
  ).toEqual([
    'https://java\tscript:alert(1)',
    'https://java\nscript:alert(1)',
    'about:blank',
    'about:blank',
    'https://example.com',
    'mailto:user@example.com',
    'https://example.com',
  ]);
  await expect(page.locator('#editor code > strong')).toHaveText('nested');
  await page.evaluate(() => {
    const leaf = document.querySelector('#editor code > strong')?.firstChild;
    if (!leaf) throw new Error('Missing nested leaf');
    document.getSelection()?.setBaseAndExtent(leaf, 6, leaf, 6);
  });
  await page.keyboard.type('!');
  await expect(page.locator('#editor code > strong')).toHaveText('nested!');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('modifier delete derives a layout target at keydown without beforeinput', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fixture.reset('first second');
    window.fixture.selectEnd();
  });
  const result = await page.evaluate(() => {
    const selection = document.getSelection();
    if (!selection?.anchorNode) throw new Error('Missing selection');
    let modifies = 0;
    const original = selection.modify.bind(selection);
    selection.modify = (...args) => {
      modifies++;
      original(...args);
    };
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('editor')?.dispatchEvent(event);
    return { modifies, prevented: event.defaultPrevented };
  });
  expect(result).toEqual({ modifies: 1, prevented: true });
  await expect(page.locator('#editor')).toHaveText('first ');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('Android native backspace deletes once and re-clears composition after 30ms', async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Android Chrome/153.0.0.0',
    })
  );
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.evaluate(() => {
    window.fixture.reset('漢字');
    window.fixture.selectEnd();
    window.fixture.count();
  });
  const result = await page.evaluate(() => {
    const root = document.getElementById('editor');
    if (!root) throw new Error('Missing editor');
    root.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' })
    );
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'MediaLast',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
      })
    );
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(event);
    // Android may ignore preventDefault: perform its one native deletion.
    const text = document.getSelection()?.anchorNode;
    if (!text) throw new Error('Missing text');
    text.nodeValue = '漢';
    document.getSelection()?.setBaseAndExtent(text, 1, text, 1);
    root.dispatchEvent(
      new InputEvent('input', {
        inputType: 'deleteContentBackward',
        bubbles: true,
      })
    );
    return { prevented: event.defaultPrevented, text: window.fixture.text() };
  });
  expect(result).toEqual({ prevented: false, text: '漢' });
  await page.clock.runFor(31);
  expect(
    await page.evaluate(
      () =>
        window.fixture.crossings.filter((name) => name === 'composition').length
    )
  ).toBe(3);
  await expect(page.locator('#editor')).toHaveText('漢');
  await page.evaluate(() => {
    const root = document.getElementById('editor');
    const event = new InputEvent('beforeinput', {
      data: '語',
      bubbles: true,
      cancelable: true,
    });
    // Desktop Chromium omits this Android/WebKit-only input type.
    Object.defineProperty(event, 'inputType', {
      value: 'insertFromComposition',
    });
    root?.dispatchEvent(event);
  });
  await expect(page.locator('#editor')).toHaveText('漢語');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('Android noncomposing backspace delegates eligible native deletion', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Android Chrome/153.0.0.0',
    })
  );
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.evaluate(() => {
    window.fixture.reset('abc');
    window.fixture.selectEnd();
    window.fixture.count();
  });
  const prevented = await page.evaluate(() => {
    const root = document.getElementById('editor');
    const event = new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward',
      bubbles: true,
      cancelable: true,
    });
    root?.dispatchEvent(event);
    const leaf = document.getSelection()?.anchorNode;
    if (!leaf) throw new Error('Missing leaf');
    leaf.nodeValue = 'ab';
    document.getSelection()?.setBaseAndExtent(leaf, 2, leaf, 2);
    root?.dispatchEvent(
      new InputEvent('input', {
        inputType: 'deleteContentBackward',
        bubbles: true,
      })
    );
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await page.evaluate(() => window.fixture.text())).toBe('ab');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('collapsed typing format survives equivalent DOM element boundary selection', async ({
  page,
}) => {
  await page.keyboard.press('Control+b');
  await page.evaluate(() => {
    const leaf = document.getSelection()?.anchorNode;
    const wrapper = leaf?.parentNode;
    if (!wrapper) throw new Error('Missing wrapper');
    document.getSelection()?.setBaseAndExtent(wrapper, 1, wrapper, 1);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.type('B');
  await expect(page.locator('#editor strong')).toHaveText('B');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('controlled character deletion uses the ABI backward and forward directions', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.fixture.reset('abcd');
    window.fixture.selectEnd();
    document.getElementById('editor')?.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#editor')).toHaveText('abc');
  await page.evaluate(() => {
    const leaf = document.getSelection()?.anchorNode;
    if (!leaf) throw new Error('Missing leaf');
    document.getSelection()?.setBaseAndExtent(leaf, 1, leaf, 1);
    document.getElementById('editor')?.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentForward',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#editor')).toHaveText('ac');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('controlled transfer-only insertion uses the plain MIME payload', async ({
  page,
}) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'transfer');
    document.getElementById('editor')?.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertFromYank',
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#editor')).toHaveText('atransfer');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('Android controlled full-node deletion clears active composition', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Android Chrome/153.0.0.0',
    })
  );
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.evaluate(() => {
    window.fixture.reset('漢字');
    window.fixture.selectEnd();
    const root = document.getElementById('editor');
    root?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' })
    );
    const leaf = document.getSelection()?.anchorNode;
    if (!leaf) throw new Error('Missing leaf');
    document.getSelection()?.setBaseAndExtent(leaf, 0, leaf, 2);
    root?.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#editor')).toHaveText('');
  await page.keyboard.type('continued');
  await expect(page.locator('#editor')).toHaveText('continued');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('unhandled targeted key invokes lower-priority view listeners', async ({
  page,
}) => {
  expect(await page.evaluate(() => window.fixture.unhandledKeyFallback())).toBe(
    1
  );
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('Android composing selection across text nodes follows controlled deletion', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 Android Chrome/153.0.0.0',
    })
  );
  await page.goto('/browser-test/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.evaluate(() => {
    const text = (value: string, format: number) => ({
      type: 'text',
      version: 1,
      text: value,
      format,
      detail: 0,
      mode: 'normal',
      style: '',
    });
    window.fixture.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [text('漢', 0), text('字', 1)],
            },
          ],
        },
      })
    );
    const root = document.getElementById('editor'),
      first = root?.querySelector('span')?.firstChild,
      second = root?.querySelector('strong')?.firstChild;
    if (!first || !second) throw new Error('Missing text nodes');
    document.getSelection()?.setBaseAndExtent(second, 1, second, 1);
    root?.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' })
    );
    document.getSelection()?.setBaseAndExtent(first, 0, second, 1);
    root?.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'deleteContentBackward',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(page.locator('#editor')).toHaveText('');
  await page.keyboard.type('continued');
  await expect(page.locator('#editor')).toHaveText('continued');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});

test('underline formatting shortcut uses the routed model command', async ({
  page,
}) => {
  await page.keyboard.press('Control+u');
  await page.keyboard.type('underlined');
  await expect(page.locator('#editor .theme-underline')).toHaveText(
    'underlined'
  );
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});
