import { expect, type Page, test } from '@playwright/test';
import {
  columnId,
  databaseId,
  definitionId,
  documentDatabaseDetail,
  rowId,
  tableId,
} from './document-data';

async function fixture(page: Page) {
  let storedName = 'Finish onboarding';
  let writes = 0;
  let creates = 0;
  const detail = documentDatabaseDetail();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error);
  });
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  // Serve the fixture's module graph through Playwright's request context.
  // Chromium otherwise cancels local module loads when host interfaces change.
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch() });
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
                items: [
                  {
                    __typename: 'GraphqlSoupDatabaseRow',
                    id: rowId,
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
                          stringValue: storedName,
                        },
                      },
                    ],
                  },
                ],
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
    storedName: () => storedName,
    writes: () => writes,
    creates: () => creates,
    errors,
  };
}

test('a database mention expands to the live editor, saves cells and collapses without losing the reference', async ({
  page,
}) => {
  const saved = await fixture(page);
  await page.getByRole('button', { name: 'Mention existing database' }).click();
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
