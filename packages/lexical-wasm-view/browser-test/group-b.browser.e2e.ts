import { expect, test } from '@playwright/test';
import type {} from './group-b-fixture';

test.beforeEach(async ({ page }, info) => {
  await page.goto(
    '/browser-test/group-b.html' +
      (info.title.includes('insert-first') ? '?insertFirst=1' : '')
  );
  await page.waitForFunction(() => Boolean(window.groupB));
});

for (const order of ['drag-first', 'insert-first']) {
  test(`native handle moves an entire first-item list and a cross-editor drop changes neither document (${order})`, async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.groupB.first.set(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'task-list',
                version: 1,
                listType: 'bullet',
                start: 1,
                children: [
                  {
                    type: 'listitem',
                    version: 1,
                    value: 1,
                    children: [{ type: 'text', version: 1, text: 'first' }],
                  },
                  {
                    type: 'listitem',
                    version: 1,
                    value: 2,
                    children: [{ type: 'text', version: 1, text: 'second' }],
                  },
                ],
              },
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'target' }],
              },
            ],
          },
        })
      );
      window.groupB.second.set(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text: 'destination' }],
              },
            ],
          },
        })
      );
    });
    const first = page.locator('#first');
    await first.locator('li').first().hover();
    const handle = page.getByRole('button', { name: 'Move block first' });
    await expect(handle).toBeVisible();
    await handle.dragTo(first.locator('p'), {
      targetPosition: { x: 30, y: 18 },
    });

    await expect(first.locator(':scope > *').first()).toHaveText('target');
    await expect(first.locator('li')).toHaveText(['first', 'second']);
    // As in Source with the app's drag plugins (drag-browser-test/cross-editor-drag):
    // the handle carries only this editor's block key, so the other editor's drag-insert
    // consumes the drop and hides its indicator, and neither document changes. Window
    // capture sees the drop before any editor handler stops it.
    await page.evaluate(() => {
      window.addEventListener(
        'drop',
        (event) => {
          if (
            event.target instanceof Node &&
            document.getElementById('second')?.contains(event.target)
          ) {
            document.body.dataset.secondDrops = String(
              Number(document.body.dataset.secondDrops ?? 0) + 1
            );
          }
        },
        true
      );
    });
    await first.locator('li').first().hover();
    await handle.dragTo(page.locator('#second p'), {
      targetPosition: { x: 30, y: 18 },
    });

    const second = page.locator('#second');
    await expect(page.locator('body')).toHaveAttribute(
      'data-second-drops',
      '1'
    );
    await expect(page.locator('[data-insertion="second"]')).toBeHidden();
    await expect(second.locator('li')).toHaveCount(0);
    await expect(second).toHaveText('destination');
    expect(
      await page.evaluate(
        () =>
          window.groupB.second
            .nodes()
            .filter((node) => node.type === 'task-list').length
      )
    ).toBe(0);
    await expect(first.locator(':scope > *').first()).toHaveText('target');
    await expect(first.locator('li')).toHaveText(['first', 'second']);
    expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
  });
}

test('native paste chooses the drop target in one admission and keeps Markdown formatting', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    window.groupB.first.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'keep' }],
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'target' }],
            },
          ],
        },
      })
    );
    const root = document.getElementById('first');
    const target = root?.lastElementChild;
    if (!root || !target) throw new Error('Missing target');
    const rect = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData('text/plain', ' **bold**');
    window.groupB.first.resetCounters();
    root.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + 20,
        clientY: rect.bottom - 1,
      })
    );
    return window.groupB.first.counters();
  });
  await expect(page.locator('#first p').first()).toHaveText('keep');
  await expect(page.locator('#first p').last()).toHaveText('target bold');
  await expect(page.locator('#first strong')).toHaveText('bold');
  expect(result).toEqual({ admissions: 1, queries: 0, nodeQueries: 0 });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('touch swipe changes the list only on release and preserves nested content', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.groupB.first.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'list',
              version: 1,
              listType: 'bullet',
              start: 1,
              children: [
                {
                  type: 'listitem',
                  version: 1,
                  value: 1,
                  children: [{ type: 'text', version: 1, text: 'one' }],
                },
                {
                  type: 'listitem',
                  version: 1,
                  value: 2,
                  children: [{ type: 'text', version: 1, text: 'two' }],
                },
                {
                  type: 'listitem',
                  version: 1,
                  value: 3,
                  children: [
                    {
                      type: 'list',
                      version: 1,
                      listType: 'bullet',
                      start: 1,
                      children: [
                        {
                          type: 'listitem',
                          version: 1,
                          value: 1,
                          children: [
                            { type: 'text', version: 1, text: 'nested' },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'listitem',
                  version: 1,
                  value: 4,
                  children: [{ type: 'text', version: 1, text: 'three' }],
                },
              ],
            },
          ],
        },
      })
    );
    const row = [...document.querySelectorAll('#first li')].find(
      (element) => element.textContent === 'two'
    );
    if (!row) throw new Error('Missing row');
    const rect = row.getBoundingClientRect();
    window.groupB.first.resetCounters();
    const before = document.getElementById('first')?.innerHTML;
    row.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: rect.left + 50,
        clientY: rect.top + 8,
      })
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: rect.left + 110,
        clientY: rect.top + 8,
      })
    );
    if (document.getElementById('first')?.innerHTML !== before)
      throw new Error('Swipe changed DOM before release');
    if (window.groupB.first.counters().admissions !== 0)
      throw new Error('Swipe crossed before release');
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: rect.left + 110,
        clientY: rect.top + 8,
      })
    );
  });
  await expect(page.locator('#first > ul > li')).toHaveCount(3);
  await expect(page.locator('#first > ul > li ul').first()).toContainText(
    'two'
  );
  await expect(page.locator('#first')).toContainText('nested');
  const counters = await page.evaluate(() => window.groupB.first.counters());
  expect(counters).toEqual({ admissions: 1, queries: 0, nodeQueries: 0 });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('a nested editor owns its paste drop before the parent capture handlers', async ({
  page,
}) => {
  const before = await page.evaluate(() => {
    window.groupB.second.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'child' }],
            },
          ],
        },
      })
    );
    window.groupB.nest();
    return window.groupB.first.json();
  });
  const counters = await page.evaluate(() => {
    const root = document.getElementById('second');
    const paragraph = root?.firstElementChild;
    if (!root || !paragraph) throw new Error('Missing child paragraph');
    const rect = paragraph.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData('text/plain', ' **nested**');
    window.groupB.first.resetCounters();
    window.groupB.second.resetCounters();
    root.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + 30,
        clientY: rect.bottom - 1,
      })
    );
    return {
      parent: window.groupB.first.counters(),
      child: window.groupB.second.counters(),
    };
  });
  await expect(page.locator('#second strong')).toHaveText('nested');
  expect(counters.parent).toEqual({
    admissions: 0,
    queries: 0,
    nodeQueries: 0,
  });
  expect(counters.child).toEqual({ admissions: 1, queries: 0, nodeQueries: 0 });
  expect(await page.evaluate(() => window.groupB.first.json())).toBe(before);
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

const tableDocument = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'table',
        version: 1,
        children: [
          ['A', 'B'],
          ['C', 'D'],
        ].map((cells) => ({
          type: 'tablerow',
          version: 1,
          children: cells.map((text) => ({
            type: 'tablecell',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [{ type: 'text', version: 1, text }],
              },
            ],
          })),
        })),
      },
    ],
  },
};
const tableState = JSON.stringify(tableDocument);

test('native table borders resize live with one snapshot and Escape restores unset row height', async ({
  page,
}) => {
  await page.evaluate((state) => {
    window.groupB.first.set(state);
    window.groupB.first.resetCounters();
  }, tableState);
  const cell = page.locator('#first td').first();
  const rect = await cell.boundingBox();
  const secondRect = await page.locator('#first td').nth(1).boundingBox();
  if (!rect || !secondRect) throw new Error('Missing cell layout');
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 49, rect.y + rect.height / 2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.groupB.first.nodes().find((node) => node.type === 'table')
            ?.props.colWidths
      )
    )
    .toEqual([rect.width + 50, secondRect.width]);
  const counters = await page.evaluate(() => window.groupB.first.counters());
  expect(counters.queries).toBe(1);
  expect(counters.nodeQueries).toBe(0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(
    await page.evaluate(
      () =>
        window.groupB.first.nodes().find((node) => node.type === 'table')?.props
          .colWidths
    )
  ).toEqual([120, 120]);

  const rowCell = await cell.boundingBox();
  if (!rowCell) throw new Error('Missing row layout');
  await page.evaluate(() => window.groupB.first.resetCounters());
  await page.mouse.move(
    rowCell.x + rowCell.width / 2,
    rowCell.y + rowCell.height - 1
  );
  await page.mouse.down();
  await page.mouse.move(
    rowCell.x + rowCell.width / 2,
    rowCell.y + rowCell.height + 39
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.groupB.first.nodes().find((node) => node.type === 'tablerow')
            ?.props.height
      )
    )
    .toBeGreaterThan(33);
  expect(
    (await page.evaluate(() => window.groupB.first.counters())).queries
  ).toBe(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.groupB.first.json())).not.toContain(
    '"height":'
  );
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('native touch table selection leaves scrolling alone and extends only after a long press', async ({
  page,
}) => {
  await page.evaluate((state) => {
    window.groupB.first.set(state);
    window.groupB.first.resetCounters();
  }, tableState);
  await page.clock.install();
  await page.evaluate(() => {
    const cell = document.querySelector('#first td');
    if (!cell) throw new Error('Missing cell');
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 77,
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
      })
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 77,
        clientX: 100,
        clientY: 120,
        bubbles: true,
      })
    );
  });
  await page.clock.runFor(401);
  expect(await page.evaluate(() => window.groupB.first.counters())).toEqual({
    admissions: 0,
    queries: 0,
    nodeQueries: 0,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(0);
  await page.evaluate(() => {
    const cell = document.querySelector('#first td');
    if (!cell) throw new Error('Missing cell');
    const rect = cell.getBoundingClientRect();
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 78,
        button: 0,
        clientX: rect.x + 30,
        clientY: rect.y + 15,
        bubbles: true,
      })
    );
  });
  await page.clock.runFor(250);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('#first td')].at(-1);
    if (!cell) throw new Error('Missing secondary cell');
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: false,
        pointerId: 79,
        button: 0,
        bubbles: true,
      })
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerType: 'touch',
        isPrimary: false,
        pointerId: 79,
        bubbles: true,
      })
    );
  });
  await page.clock.runFor(151);
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(1);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('#first td')].at(-1);
    if (!cell) throw new Error('Missing last cell');
    const rect = cell.getBoundingClientRect();
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 78,
        clientX: rect.x + 30,
        clientY: rect.y + 15,
        bubbles: true,
      })
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerType: 'touch',
        isPrimary: true,
        pointerId: 78,
        bubbles: true,
      })
    );
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(4);
  expect(await page.evaluate(() => window.groupB.first.counters())).toEqual({
    admissions: 2,
    queries: 0,
    nodeQueries: 0,
  });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('a mouse drag across cells keeps a native TableSelection over both cells', async ({
  page,
}) => {
  await page.evaluate((state) => window.groupB.first.set(state), tableState);
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(1).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  // Trusted pointer input, so Chromium runs its own text drag alongside.
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  await page.mouse.up();
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  expect(await page.evaluate(() => window.groupB.first.selection().kind)).toBe(
    'table'
  );
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

// A paragraph above the table, as in the app: when the TableSelection clears the
// DOM range, Chromium re-seeds its text drag at the editable root's first caret
// position, which is then text outside the table instead of the table wrapper.
const paragraphAboveTableState = JSON.stringify({
  root: {
    ...tableDocument.root,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', version: 1, text: 'Hello world' }],
      },
      ...tableDocument.root.children,
    ],
  },
});

// The real-app gesture from a failing run: a caret in the paragraph above, then a press
// mid-cell in A, 12 steps to the middle of D, release. Source selects all four cells,
// and commits the pointerdown caret in A before its TableSelection, so a peer's caret
// first lands in A.
test('a mouse drag from mid-cell to the diagonal cell selects the whole rectangle', async ({
  page,
}) => {
  await page.evaluate(
    (state) => window.groupB.first.set(state),
    paragraphAboveTableState
  );
  const hello = await page
    .locator('#first p')
    .filter({ hasText: 'Hello world' })
    .boundingBox();
  if (!hello) throw new Error('Missing paragraph geometry');
  await page.mouse.click(hello.x + 20, hello.y + hello.height / 2);
  const helloKey = await page.evaluate(
    () =>
      window.groupB.first.nodes().find((node) => node.text === 'Hello world')
        ?.key ?? null
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.groupB.first.selection();
        return selection.kind === 'range' ? selection.anchor.key : null;
      })
    )
    .toBe(helloKey);
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(3).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  const textKey = await page.evaluate(
    () =>
      window.groupB.first.nodes().find((node) => node.text === 'A')?.key ?? null
  );
  await page.evaluate(() => window.groupB.first.resetCommittedSelections());
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(4);
  expect(await page.evaluate(() => window.groupB.first.selection().kind)).toBe(
    'table'
  );
  const committed = await page.evaluate(() =>
    window.groupB.first.committedSelections()
  );
  const firstTable = committed.findIndex(
    (selection) => (selection as { kind: string }).kind === 'table'
  );
  expect(firstTable).toBeGreaterThan(0);
  expect(
    committed
      .slice(0, firstTable)
      .some(
        (selection) =>
          (selection as { kind: string; anchor?: { key: number } }).kind ===
            'range' &&
          (selection as { anchor: { key: number } }).anchor.key === textKey
      )
  ).toBe(true);
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

// Source control (real Source editor, Chromium): after a drag to the diagonal
// cell, carrying on out of its bottom into the paragraph below and releasing
// leaves a range from the start of the first cell to after@5, with the DOM
// anchor at the first cell (TD@0). In the app Chromium extends its drag from a
// caret left inside the table; pinned $fixRangeSelectionForSelectedTable then
// re-anchors that range at the table's start. Coverage, not a regression
// proof: this fixture's layout does not make Chromium extend its drag, so the
// test places that range itself.
test('mid-drag, a range leaving the table for the paragraph below becomes a range from the table start', async ({
  page,
}) => {
  await page.evaluate(
    (state) => window.groupB.first.set(state),
    JSON.stringify({
      root: {
        ...tableDocument.root,
        children: [
          ...tableDocument.root.children,
          {
            type: 'paragraph',
            version: 1,
            children: [{ type: 'text', version: 1, text: 'after' }],
          },
        ],
      },
    })
  );
  const afterKey = await page.evaluate(
    () => window.groupB.first.nodes().find((node) => node.text === 'after')?.key
  );
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(3).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(4);
  await page.evaluate(() => {
    const leaf = (text: string) => {
      const element = [...document.querySelectorAll('#first p')].find(
        (paragraph) => paragraph.textContent === text
      );
      const node = element
        ? document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
        : null;
      if (!node) throw new Error(`Missing ${text} text`);
      return node;
    };
    document
      .getSelection()
      ?.setBaseAndExtent(leaf('A'), 1, leaf('after'), 'after'.length);
  });
  await page.mouse.up();
  const outcome = () =>
    page.evaluate(() => {
      const model = window.groupB.first.selection();
      const dom = document.getSelection();
      return {
        kind: model.kind,
        focus: model.kind === 'range' ? model.focus : null,
        domAnchorIsFirstCell:
          dom?.anchorNode === document.querySelector('#first td') &&
          dom?.anchorOffset === 0,
      };
    });
  await expect.poll(outcome).toEqual({
    kind: 'range',
    focus: { key: afterKey, offset: 5, type: 'text' },
    domAnchorIsFirstCell: true,
  });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

// Coverage, not a regression proof: in this fixture Chromium does not extend
// its text drag from a strip outside the editor, so this passes without the
// elementsFromPoint fix. observer.test.ts pins that fix deterministically.
test('a mouse drag across an overlay above the cell border keeps a native TableSelection', async ({
  page,
}) => {
  await page.evaluate((state) => window.groupB.first.set(state), tableState);
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(1).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  // Like the column resize strip: a fixed control above the A|B border.
  await page.evaluate((x) => {
    const strip = document.createElement('div');
    strip.id = 'border-strip';
    strip.style.cssText = `position:fixed;top:0;bottom:0;left:${x - 12}px;width:24px;z-index:20`;
    document.body.append(strip);
  }, to.x);
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + 10, y);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, y);
  // The pointer crosses the border on the strip, outside the table.
  await page.mouse.move(to.x, y);
  // Chromium's own text drag now spans both cells; let its selectionchange
  // land before the pointer moves on, as it does between real moves.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await page.mouse.move(to.x + to.width / 2, y);
  await page.mouse.move(to.x + to.width - 10, y);
  await page.mouse.up();
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  expect(await page.evaluate(() => window.groupB.first.selection().kind)).toBe(
    'table'
  );
  await page.evaluate(() => document.getElementById('border-strip')?.remove());
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

// Source control (real Source editor, Chromium): with the button held after a
// drag across four cells, setBaseAndExtent onto the paragraph below kept
// table(A1->B2) and its four cells through release, and left the DOM caret
// at that paragraph; pinned $internalCreateSelection clones a TableSelection
// on selectionchange.
test('mid-drag, a caret on a sibling block outside the table keeps the table selection', async ({
  page,
}) => {
  const withParagraph = {
    root: {
      ...tableDocument.root,
      children: [
        ...tableDocument.root.children,
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'after' }],
        },
      ],
    },
  };
  await page.evaluate(
    (state) => window.groupB.first.set(state),
    JSON.stringify(withParagraph)
  );
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(1).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  await page.evaluate(async () => {
    const paragraph = [...document.querySelectorAll('#first p')].find(
      (element) => element.textContent === 'after'
    );
    if (!paragraph) throw new Error('Missing sibling paragraph');
    document.getSelection()?.setBaseAndExtent(paragraph, 0, paragraph, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  const caretOnSibling = () =>
    page.evaluate(() => {
      const selection = document.getSelection();
      return {
        model: window.groupB.first.selection().kind,
        dom:
          selection?.anchorNode instanceof Element &&
          selection.anchorNode.textContent === 'after'
            ? `${selection.anchorNode.nodeName}@${selection.anchorOffset}`
            : null,
      };
    });
  expect(await caretOnSibling()).toEqual({ model: 'table', dom: 'P@0' });
  await page.mouse.up();
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  expect(await caretOnSibling()).toEqual({ model: 'table', dom: 'P@0' });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('releasing an owned table drag leaves a nested editor caret alone', async ({
  page,
}) => {
  const state = JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        { type: 'paste', version: 1, content: 'nested host', origin: 'pasted' },
        ...tableDocument.root.children,
      ],
    },
  });
  await page.evaluate((state) => {
    window.groupB.first.set(state);
    window.groupB.second.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'nested' }],
            },
          ],
        },
      })
    );
    const host = document.querySelector('[data-nested-host="first"]');
    const child = document.getElementById('second');
    if (!host || !child) throw new Error('Missing nested editor');
    host.append(child);
  }, state);
  const cells = page.locator('#first td');
  const from = await cells.nth(0).boundingBox();
  const to = await cells.nth(1).boundingBox();
  if (!from || !to) throw new Error('Missing cell geometry');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(2);
  // The nested editor's text is the first text under the outer root, so its
  // offset-0 caret sits where Chromium re-seeds a cleared drag.
  await page.evaluate(() => {
    const text = document.querySelector('#second p')?.firstChild;
    const leaf = text?.firstChild ?? text;
    if (!leaf) throw new Error('Missing nested text');
    document.getSelection()?.setBaseAndExtent(leaf, 0, leaf, 0);
  });
  await page.mouse.up();
  expect(
    await page.evaluate(() => {
      const selection = document.getSelection();
      return {
        inNested: !!document
          .getElementById('second')
          ?.contains(selection?.anchorNode ?? null),
        offset: selection?.anchorOffset,
      };
    })
  ).toEqual({ inNested: true, offset: 0 });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('cancelled, foreign-pointer and readonly cell drags submit no table selection', async ({
  page,
}) => {
  await page.evaluate((state) => {
    window.groupB.first.set(state);
    window.groupB.first.resetCounters();
  }, tableState);
  await page.evaluate(() => {
    const cells = document.querySelectorAll('#first td');
    const first = cells.item(0),
      last = cells.item(3);
    const down = () =>
      first.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerType: 'pen',
          pointerId: 91,
          button: 0,
          bubbles: true,
        })
      );
    const move = (pointerId: number) =>
      last.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerType: 'pen',
          pointerId,
          bubbles: true,
        })
      );
    down();
    move(92);
    document.dispatchEvent(
      new PointerEvent('pointercancel', { pointerId: 91 })
    );
    move(91);
    down();
    window.groupB.first.editable(false);
    move(91);
    window.groupB.first.editable(true);
    move(91);
  });
  expect(await page.evaluate(() => window.groupB.first.counters())).toEqual({
    admissions: 0,
    queries: 0,
    nodeQueries: 0,
  });
  await expect(page.locator('#first .fixture-cell-selected')).toHaveCount(0);
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('native table keys preserve browser defaults and cell ranges in one admission', async ({
  page,
}) => {
  await page.evaluate((state) => window.groupB.first.set(state), tableState);
  const middle = await page.evaluate(() => {
    window.groupB.first.caret('A', 0);
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      counters: window.groupB.first.counters(),
    };
  });
  expect(middle).toEqual({
    prevented: false,
    counters: { admissions: 1, queries: 0, nodeQueries: 0 },
  });
  const edge = await page.evaluate(() => {
    window.groupB.first.caret('A', 1);
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    const b = window.groupB.first.nodes().find((node) => node.text === 'B');
    return {
      prevented: event.defaultPrevented,
      selection: window.groupB.first.selection(),
      b: b?.key,
      counters: window.groupB.first.counters(),
    };
  });
  expect(edge.prevented).toBe(true);
  expect(edge.selection).toEqual({
    kind: 'range',
    anchor: { key: edge.b, offset: 0, type: 'text' },
    focus: { key: edge.b, offset: 0, type: 'text' },
  });
  expect(edge.counters).toEqual({ admissions: 1, queries: 0, nodeQueries: 0 });
  const saturated = await page.evaluate(() => {
    const cells = window.groupB.first
      .nodes()
      .filter((node) => node.type === 'tablecell');
    const a = cells.at(0),
      b = cells.at(1);
    if (!a || !b) throw new Error('Missing table cells');
    window.groupB.first.selectCells(a.key, b.key);
    const before = window.groupB.first.selection();
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      before,
      after: window.groupB.first.selection(),
      counters: window.groupB.first.counters(),
    };
  });
  expect(saturated.prevented).toBe(true);
  expect(saturated.after).toEqual(saturated.before);
  expect(saturated.counters).toEqual({
    admissions: 1,
    queries: 0,
    nodeQueries: 0,
  });
  const escaped = await page.evaluate(() => {
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      selection: window.groupB.first.selection(),
      counters: window.groupB.first.counters(),
    };
  });
  expect(escaped.prevented).toBe(true);
  expect(escaped.selection).toEqual({
    kind: 'range',
    anchor: { key: edge.b, offset: 1, type: 'text' },
    focus: { key: edge.b, offset: 1, type: 'text' },
  });
  expect(escaped.counters).toEqual({
    admissions: 1,
    queries: 0,
    nodeQueries: 0,
  });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('native table vertical arrows use fresh DOM geometry and respect typeahead menus', async ({
  page,
}) => {
  await page.evaluate((state) => window.groupB.first.set(state), tableState);
  const menu = await page.evaluate(() => {
    window.groupB.first.caret('A', 0);
    const root = document.getElementById('first');
    root?.setAttribute('aria-controls', 'typeahead-menu');
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    root?.dispatchEvent(event);
    root?.removeAttribute('aria-controls');
    return {
      prevented: event.defaultPrevented,
      counters: window.groupB.first.counters(),
    };
  });
  expect(menu).toEqual({
    prevented: false,
    counters: { admissions: 1, queries: 0, nodeQueries: 0 },
  });
  const moved = await page.evaluate(() => {
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    const c = window.groupB.first.nodes().find((node) => node.text === 'C');
    return {
      prevented: event.defaultPrevented,
      selection: window.groupB.first.selection(),
      c: c?.key,
      counters: window.groupB.first.counters(),
    };
  });
  expect(moved.prevented).toBe(true);
  expect(moved.selection).toEqual({
    kind: 'range',
    anchor: { key: moved.c, offset: 0, type: 'text' },
    focus: { key: moved.c, offset: 0, type: 'text' },
  });
  expect(moved.counters).toEqual({ admissions: 1, queries: 0, nodeQueries: 0 });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('post-default table checks use one batch admission for multiple tables', async ({
  page,
}) => {
  const state = JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'before' }],
        },
        ...tableDocument.root.children,
        ...tableDocument.root.children,
      ],
    },
  });
  await page.evaluate(async (state) => {
    window.groupB.first.set(state);
    window.groupB.first.caret('before', 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  }, state);
  const counters = await page.evaluate(async () => {
    window.groupB.first.resetCounters();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('first')?.dispatchEvent(event);
    const immediate = window.groupB.first.counters();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
    return {
      prevented: event.defaultPrevented,
      immediate,
      final: window.groupB.first.counters(),
    };
  });
  expect(counters.prevented).toBe(false);
  expect(counters.immediate).toEqual({
    admissions: 1,
    queries: 0,
    nodeQueries: 0,
  });
  expect(counters.final).toEqual({ admissions: 2, queries: 0, nodeQueries: 0 });
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('a pending parent table correction cannot steal nested-editor focus', async ({
  page,
}) => {
  const state = JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'before' }],
        },
        ...tableDocument.root.children,
        { type: 'paste', version: 1, content: 'nested host', origin: 'pasted' },
      ],
    },
  });
  await page.evaluate(async (state) => {
    window.groupB.first.set(state);
    window.groupB.second.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'nested' }],
            },
          ],
        },
      })
    );
    const host = document.querySelector('[data-nested-host="first"]');
    const child = document.getElementById('second');
    if (!host || !child) throw new Error('Missing nested editor');
    host.append(child);
    window.groupB.first.caret('before', 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
  }, state);
  const counters = await page.evaluate(async () => {
    window.groupB.first.resetCounters();
    document.getElementById('first')?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    );
    const immediate = window.groupB.first.counters();
    window.groupB.second.caret('nested', 1);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve())
    );
    return {
      immediate,
      final: window.groupB.first.counters(),
      focus: document.activeElement?.id,
    };
  });
  expect(counters.immediate).toEqual({
    admissions: 1,
    queries: 0,
    nodeQueries: 0,
  });
  expect(counters.final).toEqual(counters.immediate);
  expect(counters.focus).toBe('second');
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});

test('native roots retain editable wrapping and source automatic block direction', async ({
  page,
}) => {
  await page.evaluate(() => {
    document.getElementById('first')?.classList.add('md');
    window.groupB.first.set(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [{ type: 'paragraph', version: 1, children: [] }],
        },
      })
    );
  });
  const styles = await page.locator('#first').evaluate((root) => ({
    md: root.classList.contains('md'),
    userSelect: root.style.userSelect,
    whiteSpace: root.style.whiteSpace,
    wordBreak: root.style.wordBreak,
  }));
  expect(styles).toEqual({
    md: true,
    userSelect: 'text',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  await expect(page.locator('#first p')).toHaveAttribute('dir', 'auto');
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});
