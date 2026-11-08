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
  test(`native handle moves an entire first-item list and cross-editor drop copies it (${order})`, async ({
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
    await first.locator('li').first().hover();
    await handle.dragTo(page.locator('#second p'), {
      targetPosition: { x: 30, y: 18 },
    });

    await expect(page.locator('#second li')).toHaveText(['first', 'second']);
    expect(
      await page.evaluate(
        () =>
          window.groupB.second
            .nodes()
            .filter((node) => node.type === 'task-list').length
      )
    ).toBe(1);
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

const tableState = JSON.stringify({
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
});

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
  await expect(
    page.locator('#first [data-lexical-table-selected]')
  ).toHaveCount(0);
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
  await expect(
    page.locator('#first [data-lexical-table-selected]')
  ).toHaveCount(1);
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
  await expect(
    page.locator('#first [data-lexical-table-selected]')
  ).toHaveCount(4);
  expect(await page.evaluate(() => window.groupB.first.counters())).toEqual({
    admissions: 2,
    queries: 0,
    nodeQueries: 0,
  });
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
  await expect(
    page.locator('#first [data-lexical-table-selected]')
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.groupB.errors)).toEqual([]);
});
