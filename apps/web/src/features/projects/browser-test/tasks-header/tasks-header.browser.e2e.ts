import { expect, type Locator, type Page, test } from '@playwright/test';

const GUTTER = 16;

async function open(page: Page) {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/');
  await expect(page.getByTestId('creates')).toBeAttached();
}

function filters(page: Page, project: string) {
  return page.getByRole('button', {
    name: project === 'desktop' ? 'Filter tasks' : 'Open task filters',
  });
}

async function expectOnScreen(page: Page, controls: Locator[]) {
  const width = page.viewportSize()?.width ?? 0;
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x).toBeGreaterThanOrEqual(GUTTER);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      width - GUTTER
    );
  }
}

test('keeps every header control on screen, with search closed and open', async ({
  page,
}, info) => {
  await open(page);
  const add = page.getByRole('button', { name: 'Add existing tasks' });
  const create = page.getByRole('button', { name: 'New task' });
  const searchButton = page.getByRole('button', { name: 'Search in Launch' });
  await expectOnScreen(page, [
    searchButton,
    filters(page, info.project.name),
    add,
    create,
  ]);

  await searchButton.click();
  const search = page.getByRole('searchbox', { name: 'Search in Launch' });
  await expect(search).toBeFocused();
  await search.fill('test');
  await expectOnScreen(page, [
    search,
    page.getByRole('button', { name: 'Close search' }),
    filters(page, info.project.name),
    add,
    create,
  ]);
});

test('keeps action labels where they fit', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('phone'), 'Phones show icons');
  await open(page);
  for (const name of ['Add existing tasks', 'New task']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan((box?.height ?? 0) * 2);
  }
});

test('Add existing tasks opens its picker and cancels without adding', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Add existing tasks' }).click();
  const picker = page.getByRole('textbox', { name: 'Search tasks' });
  await expect(picker).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('assignments')).toHaveText('0');
});

test('New task starts a task', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
});
