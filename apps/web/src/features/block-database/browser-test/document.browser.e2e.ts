import { expect, type Page, test, type WebSocketRoute } from '@playwright/test';
import { allRecordsView } from '../../database/core/views';
import {
  columnId,
  databaseId,
  definitionId,
  documentDatabaseDetail,
  rowId,
  tableId,
} from './document-data';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function fixture(page: Page, multipleTables = false) {
  let storedName = 'Finish onboarding';
  let writes = 0;
  let creates = 0;
  const detail = documentDatabaseDetail();
  if (multipleTables) {
    const next = structuredClone(detail.tables[0]);
    next.table.id = tableId.replace(/1$/, '2');
    next.table.name = 'Contacts and customer research';
    next.views = [
      {
        ...allRecordsView(next.table),
        id: '01990000-0000-7000-8000-00000000b001',
        name: 'Research',
      },
    ];
    for (const column of next.columns) {
      column.column.id = column.column.id.replace(/1$/, '2');
      column.column.table_id = next.table.id;
    }
    detail.tables.push(next);
  }
  const externalRows: string[] = [];
  let gateway: WebSocketRoute | undefined;
  const tracking: { action: string; entity_id: string }[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error);
  });
  await page.routeWebSocket('**', async (socket) => {
    if (!socket.url().includes('connection-gateway')) {
      await socket.close();
      return;
    }
    gateway = socket;
    socket.onMessage((message) => {
      if (message === 'ping') socket.send('pong');
      else tracking.push(JSON.parse(message.toString()));
    });
  });
  await page.route('https://**', (route) => route.abort());
  // Serve the fixture's module graph through Playwright's request context.
  // Chromium otherwise cancels local module loads when host interfaces change.
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch({ maxRetries: 2 }) });
  });
  await page.route('**/__macro_dev/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/items/soup/graphql')) {
      await route.fulfill({
        json: {
          data: {
            user: {
              soup: {
                nextCursor: null,
                items: [storedName, ...externalRows].map((name, index) => ({
                  __typename: 'GraphqlSoupDatabaseRow',
                  id: index
                    ? `${rowId.slice(0, -4)}${String(index + 1).padStart(4, '0')}`
                    : rowId,
                  tableId,
                  position: '80',
                  ownerId: detail.database.owner_id,
                  createdAt: detail.database.created_at,
                  updatedAt: detail.database.created_at,
                  cacheProjection: null,
                  notifications: [],
                  properties: [
                    {
                      id: definitionId,
                      propertyDefinitionId: definitionId,
                      value: {
                        __typename: 'GraphqlStringPropertyValue',
                        stringValue: name,
                      },
                    },
                  ],
                })),
              },
            },
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/databases') && request.method() === 'POST') {
      creates++;
      await route.fulfill({ json: { id: databaseId } });
      return;
    }
    if (url.pathname.endsWith(`/databases/${databaseId}/ops`)) {
      const body = request.postDataJSON();
      const change = body.ops.find(
        (op: { kind: string }) => op.kind === 'rows'
      )?.change;
      if (change?.kind === 'update') {
        storedName = change.changes.rows[0].cells.find(
          (cell: { column: string }) => cell.column === columnId
        ).value.value;
      }
      writes++;
      detail.tables[0].table.version++;
      await route.fulfill({
        json: {
          results: [
            {
              kind: 'rows',
              table: tableId,
              tableVersion: detail.tables[0].table.version,
              change: { kind: 'updated', affected: 1 },
            },
          ],
          changes: [
            {
              table: tableId,
              version: detail.tables[0].table.version,
              change: writes,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith(`/databases/${databaseId}`)) {
      await route.fulfill({ json: detail });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.goto('/src/features/block-database/browser-test/document.html');
  return {
    tracking,
    addExternalRows: (names: string[]) => {
      externalRows.push(...names);
      detail.tables[0].table.version++;
      gateway?.send(
        JSON.stringify({
          type: 'database_table_changed',
          data: {
            databaseId,
            tableId,
            version: detail.tables[0].table.version,
          },
        })
      );
    },
    storedName: () => storedName,
    writes: () => writes,
    creates: () => creates,
    errors,
  };
}

test('a compact database mention expands to the live editor, saves cells and collapses without losing the reference', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  const grid = page.getByRole('grid', { name: 'Tasks' });
  await expect(grid).toBeVisible();
  await page
    .getByRole('button', { name: /^Name: Finish onboarding\./ })
    .dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Ready to launch');
  await input.press('Tab');
  await expect.poll(saved.storedName).toBe('Ready to launch');
  await expect.poll(saved.writes).toBe(1);
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(grid).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Expand database' })
  ).toBeVisible();
  await expect(page.getByLabel('Document state')).toContainText(
    'document-mention'
  );
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(grid).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Name: Ready to launch\./ })
  ).toBeVisible();
  await expect(page.getByLabel('Document state')).toContainText('Launch plan');
  expect(saved.creates()).toBe(0);
  expect(saved.errors).toEqual([]);
});

test('embedded tables subscribe to the gateway and display externally added rows without reloading', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await expect
    .poll(() => saved.tracking.filter((event) => event.action === 'open'))
    .toContainEqual(expect.objectContaining({ entity_id: databaseId }));
  saved.addExternalRows(['Alpha widget', 'Juliet flux capacitor']);
  await expect(
    page.getByRole('button', { name: /^Name: Alpha widget\./ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Name: Juliet flux capacitor\./ })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect
    .poll(() => saved.tracking.filter((event) => event.action === 'close'))
    .toContainEqual(expect.objectContaining({ entity_id: databaseId }));
  expect(saved.errors).toEqual([]);
});

test('the shared toolbar changes inline filters and sorting without writing the saved view', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Add sort', exact: true }).click();
  await page.getByRole('button', { name: /^Sort direction/ }).click();
  await page.getByRole('option', { name: 'Descending', exact: true }).click();
  await page.getByRole('button', { name: 'Close sort' }).click();
  await expect(page.getByRole('button', { name: 'Sort 1' })).toBeFocused();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByRole('textbox', { name: 'Filter value' }).fill('Finish');
  await page.getByRole('button', { name: 'Close filter' }).click();
  await expect(page.getByRole('button', { name: 'Filter 1' })).toBeFocused();
  await page.getByRole('button', { name: 'Sort 1' }).click();
  await expect(
    page.getByRole('button', { name: /^Sort direction/ })
  ).toContainText('Descending');
  await page.getByRole('button', { name: 'Close sort' }).click();
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375
  );
  await page.screenshot({ path: '/tmp/database-shared-toolbar-mobile.png' });
  expect(saved.writes()).toBe(0);
  expect(saved.errors).toEqual([]);
});

test('the app table picker switches tables with the keyboard and restores focus when dismissed', async ({
  page,
}) => {
  const saved = await fixture(page, true);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  const picker = page.getByRole('button', { name: /^Database table/ });
  await picker.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await picker.press('Escape');
  await expect(picker).toBeFocused();
  await picker.press('ArrowDown');
  await page
    .getByRole('option', { name: 'Tasks', exact: true })
    .press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('grid', { name: 'Contacts and customer research' })
  ).toBeVisible();
  await expect(page.getByLabel('Document state')).toContainText(
    tableId.replace(/1$/, '2')
  );
  await expect(picker).toBeFocused();
  const views = page.getByRole('button', { name: /^Database view / });
  await views.click();
  await page.getByRole('option', { name: 'Research', exact: true }).click();
  await expect(views).toBeFocused();
  await expect(page.getByLabel('Document state')).toContainText(
    '01990000-0000-7000-8000-00000000b001'
  );
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(picker).toContainText('Contacts and customer research');
  await expect(views).toContainText('Research');
  expect(saved.errors).toEqual([]);
});

test('slash database creates an expanded editor and slash query inserts the existing query node', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByText('Launch plan', { exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/database');
  await page.getByText('Database', { exact: true }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  expect(saved.creates()).toBe(1);
  await page.getByText('Launch plan', { exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('/query');
  await page.getByText('Query', { exact: true }).click();
  await expect(page.getByLabel('Document state')).toContainText(
    'database-query'
  );
  expect(saved.creates()).toBe(1);
  expect(saved.errors).toEqual([]);
});

test('database permissions control edits independently of the document', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
  await page.getByRole('button', { name: 'Expand database' }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle document editing' }).click();
  await page
    .getByRole('button', { name: /^Name: Finish onboarding\./ })
    .dblclick();
  const input = page.getByRole('textbox', { name: 'Edit Name' });
  await input.fill('Edited through a read-only document');
  await input.press('Tab');
  await expect
    .poll(saved.storedName)
    .toBe('Edited through a read-only document');
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toHaveCount(0);
  await expect(page.getByLabel('Document state')).toContainText(
    'document-card'
  );
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(page.getByRole('grid', { name: 'Tasks' })).toBeVisible();
  await page.getByRole('button', { name: 'Database viewer' }).click();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add column', exact: true })
  ).toHaveCount(0);
  await page
    .getByRole('button', {
      name: /^Name: Edited through a read-only document$/,
    })
    .dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit Name' })).toHaveCount(0);
  expect(saved.writes()).toBe(1);
  expect(saved.errors).toEqual([]);
});
