import { expect, type Page, test } from '@playwright/test';
import type { ListEnterWindow } from './list-enter';

/**
 * Enter in lists, Notion-style, on every editor flavor: Enter on an item with
 * text adds an item, Enter on an empty top-level item leaves the list, and
 * Enter on an empty nested item outdents it one level. In a composer whose
 * Enter sends, Enter inside a list belongs to the list; it sends once the
 * caret is outside every list, and Cmd/Ctrl+Enter sends from anywhere.
 */

type Case = {
  name: string;
  initial: string;
  /** Own text of the block the caret starts in. */
  caret: string;
  edge?: 'start' | 'end';
  keys: string[];
  outline: string[];
  /** Outline line of the block holding the caret afterwards. */
  caretLine: string;
};

const CASES: Case[] = [
  {
    name: 'Enter at the end of the last item adds an item',
    initial: '- one\n- two',
    caret: 'two',
    keys: ['Enter'],
    outline: ['- one', '- two', '- '],
    caretLine: '- ',
  },
  {
    name: 'Enter at the end of a middle item adds an item below it',
    initial: '- one\n- two\n- three',
    caret: 'one',
    keys: ['Enter'],
    outline: ['- one', '- ', '- two', '- three'],
    caretLine: '- ',
  },
  {
    name: 'Enter at the start of an item adds an empty item above it',
    initial: '- one\n- two',
    caret: 'two',
    edge: 'start',
    keys: ['Enter'],
    outline: ['- one', '- ', '- two'],
    caretLine: '- two',
  },
  {
    name: 'Enter on an empty last item leaves the list',
    initial: '- one\n- two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['- one', '- two', '¶ '],
    caretLine: '¶ ',
  },
  {
    name: 'Enter on an empty middle item splits the list around a paragraph',
    initial: '- one\n- two\n- three',
    caret: 'one',
    keys: ['Enter', 'Enter'],
    outline: ['- one', '¶ ', '- two', '- three'],
    caretLine: '¶ ',
  },
  {
    name: 'Enter on an empty nested item outdents it one level',
    initial: '- one\n  - two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['- one', '  - two', '- '],
    caretLine: '- ',
  },
  {
    name: 'Enter keeps outdenting until the list is left',
    initial: '- one\n  - two\n    - three',
    caret: 'three',
    keys: ['Enter', 'Enter', 'Enter', 'Enter'],
    outline: ['- one', '  - two', '    - three', '¶ '],
    caretLine: '¶ ',
  },
  {
    name: 'an outdented middle item keeps the items below it nested',
    initial: '- one\n  - two\n  - three\n- four',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['- one', '  - two', '- ', '  - three', '- four'],
    caretLine: '- ',
  },
  {
    name: 'an item holding only spaces counts as empty',
    initial: '- one\n- two',
    caret: 'two',
    keys: ['Enter', 'Space', 'Space', 'Enter'],
    outline: ['- one', '- two', '¶ '],
    caretLine: '¶ ',
  },
  {
    name: 'leaving the list keeps the paragraph after it',
    initial: '- one\n- two\n\nafter',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['- one', '- two', '¶ ', '¶ after'],
    caretLine: '¶ ',
  },
  {
    name: 'numbered: Enter adds the next number',
    initial: '1. one\n2. two',
    caret: 'two',
    keys: ['Enter'],
    outline: ['1. one', '2. two', '3. '],
    caretLine: '3. ',
  },
  {
    name: 'numbered: Enter on an empty last item leaves the list',
    initial: '1. one\n2. two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['1. one', '2. two', '¶ '],
    caretLine: '¶ ',
  },
  {
    name: 'numbered: Enter on an empty nested item outdents it',
    initial: '1. one\n   1. two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['1. one', '  1. two', '2. '],
    caretLine: '2. ',
  },
  {
    name: 'checklist: Enter adds an unchecked item',
    initial: '- [ ] one\n- [x] two',
    caret: 'two',
    keys: ['Enter'],
    outline: ['[ ] one', '[x] two', '[ ] '],
    caretLine: '[ ] ',
  },
  {
    name: 'checklist: Enter on an empty last item leaves the list',
    initial: '- [ ] one\n- [ ] two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['[ ] one', '[ ] two', '¶ '],
    caretLine: '¶ ',
  },
  {
    name: 'checklist: Enter on an empty nested item outdents it',
    initial: '- [ ] one\n  - [ ] two',
    caret: 'two',
    keys: ['Enter', 'Enter'],
    outline: ['[ ] one', '  [ ] two', '[ ] '],
    caretLine: '[ ] ',
  },
];

const FIXTURE =
  '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/list-enter.html';

function read<T>(page: Page, key: 'outline' | 'caretLine' | 'sent') {
  return page.evaluate((name) => {
    const listEnter = (window as ListEnterWindow).listEnter;
    if (!listEnter) throw new Error('list-enter fixture is not ready');
    return listEnter[name]();
  }, key) as Promise<T>;
}

const outline = (page: Page) => read<string[]>(page, 'outline');
const caretLine = (page: Page) => read<string | null>(page, 'caretLine');
const sent = (page: Page) => read<string[]>(page, 'sent');

async function open(page: Page, surface: string) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(`${FIXTURE}?surface=${surface}`);
  await expect(page.getByRole('textbox', { name: 'Editor' })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForFunction(() =>
    Boolean((window as ListEnterWindow).listEnter)
  );
}

async function load(page: Page, markdown: string, expected: string[]) {
  await page.evaluate(
    (value) => (window as ListEnterWindow).listEnter?.load(value),
    markdown
  );
  await expect.poll(() => outline(page)).toEqual(expected);
}

async function placeCaret(page: Page, text: string, edge: 'start' | 'end') {
  const found = await page.evaluate(
    ([value, side]) =>
      (window as ListEnterWindow).listEnter?.caretAt(value, side) ?? false,
    [text, edge] as const
  );
  expect(found).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.ariaLabel))
    .toBe('Editor');
}

for (const surface of ['document', 'markdown', 'chat']) {
  test.describe(`${surface} editor`, () => {
    let page: Page;
    const errors: string[] = [];

    test.beforeAll(async ({ browser }, testInfo) => {
      const {
        baseURL,
        viewport,
        hasTouch,
        isMobile,
        userAgent,
        deviceScaleFactor,
      } = testInfo.project.use;
      page = await browser.newPage({
        baseURL,
        viewport,
        hasTouch,
        isMobile,
        userAgent,
        deviceScaleFactor,
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await open(page, surface);
    });
    test.afterAll(() => page.close());
    test.afterEach(() => expect(errors.splice(0)).toEqual([]));

    for (const testCase of CASES) {
      test(testCase.name, async () => {
        await load(page, testCase.initial, outlineOf(testCase.initial));
        await placeCaret(page, testCase.caret, testCase.edge ?? 'end');
        for (const key of testCase.keys) await page.keyboard.press(key);
        await expect.poll(() => outline(page)).toEqual(testCase.outline);
        expect(await caretLine(page)).toBe(testCase.caretLine);
        expect(await sent(page)).toEqual([]);
      });
    }

    if (surface !== 'chat') return;

    test('Enter outside a list sends', async () => {
      await load(page, '- one\n- two\n\nafter', ['- one', '- two', '¶ after']);
      await placeCaret(page, 'after', 'end');
      await page.keyboard.press('Enter');
      expect(await sent(page)).toEqual(['- one\n- two\n\nafter']);
    });

    test('Enter on the paragraph after leaving a list sends the list', async () => {
      await load(page, '- one', ['- one']);
      await placeCaret(page, 'one', 'end');
      await page.keyboard.type('\n');
      await page.keyboard.type('two');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      expect(await sent(page)).toEqual([]);
      expect(await caretLine(page)).toBe('¶ ');
      await page.keyboard.press('Enter');
      const [message] = await sent(page);
      expect(message?.trim()).toBe('- one\n- two');
    });

    test('Cmd/Ctrl+Enter inside a list sends', async () => {
      await load(page, '- one\n- two', ['- one', '- two']);
      await placeCaret(page, 'two', 'end');
      await page.keyboard.press('ControlOrMeta+Enter');
      expect(await sent(page)).toEqual(['- one\n- two']);
      expect(await outline(page)).toEqual(['- one', '- two']);
    });

    test('Shift+Enter inside a list still adds an item', async () => {
      await load(page, '- one\n- two', ['- one', '- two']);
      await placeCaret(page, 'two', 'end');
      await page.keyboard.press('Shift+Enter');
      expect(await outline(page)).toEqual(['- one', '- two', '- ']);
      expect(await sent(page)).toEqual([]);
    });
  });
}

/** The outline a case's starting Markdown loads as. */
function outlineOf(markdown: string): string[] {
  return markdown.split('\n').flatMap((line) => {
    if (line === '') return [];
    const match = /^(\s*)(?:- \[( |x)\]|(-)|(\d+)\.) (.*)$/.exec(line);
    if (!match) return [`¶ ${line}`];
    const [, indent = '', check, , number, text = ''] = match;
    const depth = Math.round(indent.length / (number ? 3 : 2));
    const marker = check ? `[${check}]` : number ? `${number}.` : '-';
    return [`${'  '.repeat(depth)}${marker} ${text}`];
  });
}
