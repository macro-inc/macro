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

/** Desktop keeps New task in the header; touch floats it above the dock. */
function headerCreate(page: Page, project: string) {
  return project === 'desktop'
    ? [page.getByRole('button', { name: 'New task' })]
    : [];
}

function filters(page: Page, project: string) {
  return page.getByRole('button', {
    name: project === 'desktop' ? 'Filter tasks' : 'Open task filters',
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
  const add = page.getByRole('button', { name: 'Add existing tasks' });
  const create = headerCreate(page, info.project.name);
  const searchButton = page.getByRole('button', { name: 'Search in Launch' });
  await expectOnScreen(page, [
    searchButton,
    filters(page, info.project.name),
    add,
    ...create,
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
    ...create,
  ]);
});

test('keeps action labels where they fit', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('phone'), 'Phones show icons');
  await open(page);
  for (const action of [
    page.getByRole('button', { name: 'Add existing tasks' }),
    ...headerCreate(page, info.project.name),
  ]) {
    const box = await action.boundingBox();
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

test('Add existing tasks adds the picked tasks, from a sheet on touch', async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Add existing tasks' }).click();
  await page.getByRole('button', { name: 'Select tasks' }).click();
  if (info.project.name === 'desktop') {
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('button', { name: 'Add 1 task' }).click();
  } else {
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
  }
  await expect(page.getByTestId('assignments')).toHaveText('1');
  await expect(
    page.getByRole('textbox', { name: 'Search tasks' })
  ).toBeHidden();
});

test('header icon buttons share one size on phones', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('phone'), 'Phones show icons');
  await open(page);
  const boxes = await Promise.all(
    [
      page.getByRole('button', { name: 'Search in Launch' }),
      filters(page, info.project.name),
      page.getByRole('button', { name: 'Add existing tasks' }),
    ].map((button) => button.boundingBox())
  );
  const sizes = boxes.map((box) => `${box?.width}x${box?.height}`);
  expect(new Set(sizes).size, sizes.join(', ')).toBe(1);
});

test('the one New task control creates the task in the project', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('creates')).toHaveText('1');
  await expect(page.getByTestId('outside-creates')).toHaveText('0');
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
