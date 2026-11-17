import { expect, type Locator, type Page, test } from '@playwright/test';

const GUTTER = 16;

async function open(page: Page, path = '/') {
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname === '127.0.0.1')
      return route.continue();
    return route.abort();
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(path);
  await expect(page.getByTestId('creates')).toBeAttached();
}

function filters(page: Page, project: string) {
  return page.getByRole('button', {
    name: project === 'desktop' ? 'Filter tasks' : 'Open task filters',
  });
}

function taskAction(page: Page, project: string) {
  return page.getByRole('button', {
    name: project.startsWith('phone') ? 'Task' : 'Add task',
    exact: true,
  });
}

async function expectOnScreen(page: Page, controls: Locator[]) {
  const width = page.viewportSize()?.width ?? 0;
  for (const control of controls) {
    const edges = async () => {
      const box = await control.boundingBox();
      return box ? [box.x, box.x + box.width] : [Number.NaN, Number.NaN];
    };
    await expect
      .poll(async () => (await edges())[0])
      .toBeGreaterThanOrEqual(GUTTER);
    await expect
      .poll(async () => (await edges())[1])
      .toBeLessThanOrEqual(width - GUTTER);
  }
}

test('keeps every header control on screen, with search closed and open', async ({
  page,
}, info) => {
  await open(page);
  const add = taskAction(page, info.project.name);
  const searchButton = page.getByRole('button', { name: 'Search in Launch' });
  await expectOnScreen(page, [
    searchButton,
    filters(page, info.project.name),
    add,
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
  ]);
});

test('keeps action labels where they fit', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('phone'), 'Phones show icons');
  await open(page);
  const box = await taskAction(page, info.project.name).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan((box?.height ?? 0) * 2);
});

test('Add existing tasks opens its picker and cancels without adding', async ({
  page,
}, info) => {
  await open(page);
  await taskAction(page, info.project.name).click();
  await page.getByText('Add existing tasks', { exact: true }).click();
  const picker = page.getByRole('textbox', { name: 'Search tasks' });
  await expect(picker).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('assignments')).toHaveText('0');
});

test('the one New task control creates the task in the project', async ({
  page,
}, info) => {
  await open(page);
  await taskAction(page, info.project.name).click();
  await page.getByText('New task', { exact: true }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await expect(taskAction(page, info.project.name)).toHaveCount(1);
});

test('without edit access, nothing creates a task outside the project', async ({
  page,
}) => {
  await open(page, '/?readOnly');
  await expect(
    page.getByRole('button', { name: 'Search in Launch' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
});
