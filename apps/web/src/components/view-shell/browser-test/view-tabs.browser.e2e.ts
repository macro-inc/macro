import { expect, type Page, test } from '@playwright/test';

const fixture = '/src/components/view-shell/browser-test/view-tabs.html';

// A split wide enough for a sidebar, and one under the 720px breakpoint.
const WIDTHS = ['', '?width=700'];

async function open(page: Page, query: string) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(fixture + query, { waitUntil: 'networkidle' });
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));

  const grid = page.getByRole('grid', { name: 'Email' });
  await grid.focus();
  await expect(grid).toBeFocused();
  return { grid, tab: page.getByTestId('tab') };
}

for (const width of WIDTHS) {
  test(`Tab and the number keys move along the header's tabs from the list${width}`, async ({
    page,
  }) => {
    const { tab } = await open(page, width);

    await page.keyboard.press('Tab');
    await expect(tab).toHaveText('noise');
    await page.keyboard.press('Tab');
    await expect(tab).toHaveText('focus');
    await page.keyboard.press('Shift+Tab');
    await expect(tab).toHaveText('noise');
    await page.keyboard.press('2');
    await expect(tab).toHaveText('important');
  });

  test(`Tab is focus order on a header button${width}`, async ({ page }) => {
    const { tab } = await open(page, width);
    const filter = page.getByRole('button', { name: 'Filter' });
    await filter.focus();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'New' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(filter).toBeFocused();
    await page.keyboard.press('3');
    await expect(tab).toHaveText('important');
  });

  test(`Tab, Shift+Tab and the number keys keep an open thread open${width}`, async ({
    page,
  }) => {
    const { tab } = await open(page, width);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const thread = page.getByRole('article', { name: 'Thread' });
    await expect(thread).toBeVisible();
    await expect(
      page.getByRole('radiogroup', { name: 'Inbox view' })
    ).toHaveCount(0);

    // Nothing focused, as after opening, then on the thread's own controls.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Archive' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await page.getByRole('button', { name: 'Reply' }).focus();
    await page.keyboard.press('Tab');

    await expect(thread).toBeVisible();
    await expect(tab).toHaveText('important');
  });
}

test('a click in a thread beside the list keeps Tab for the thread', async ({
  page,
}) => {
  const { grid, tab } = await open(page, '?readingPane');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const thread = page.getByRole('article', { name: 'Thread' });
  await expect(thread).toBeVisible();

  // Plain text takes no focus, so the split itself has the keyboard.
  await thread.getByText('Here is the plan for next quarter.').click();
  await page.keyboard.press('2');
  await page.keyboard.press('3');
  await page.keyboard.press('Tab');
  await expect(thread).toBeVisible();
  await expect(tab).toHaveText('important');

  // Back on the list, Tab moves along the tabs again.
  await grid.focus();
  await page.keyboard.press('Tab');
  await expect(tab).toHaveText('noise');
});

async function openWithSidebar(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${fixture}?sidebar`, { waitUntil: 'networkidle' });
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));

  const folders = page.getByRole('navigation', { name: 'Email tabs' });
  await expect(folders).toBeVisible();
  return {
    tab: page.getByTestId('tab'),
    section: page.getByTestId('section'),
    folder: (name: string) => folders.getByRole('button', { name }),
    project: page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('button', { name: 'Launch plan' }),
    rail: page
      .getByRole('navigation', { name: 'App' })
      .getByRole('button', { name: 'Mail' }),
  };
}

test('a folder chosen in the sidebar with the mouse leaves Tab and the number keys to the header tabs', async ({
  page,
}) => {
  const { tab, folder } = await openWithSidebar(page);
  await folder('Favorites').click();
  await folder('Inbox').click();
  // Chromium focuses a clicked button.
  await expect(folder('Inbox')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(tab).toHaveText('noise');
  await page.keyboard.press('Tab');
  await expect(tab).toHaveText('focus');
  await page.keyboard.press('Shift+Tab');
  await expect(tab).toHaveText('noise');
  await page.keyboard.press('2');
  await expect(tab).toHaveText('important');
  await expect(folder('Inbox')).toBeFocused();
});

test('a folder without header tabs leaves Tab to focus order', async ({
  page,
}) => {
  const { tab, folder } = await openWithSidebar(page);
  await folder('Favorites').click();

  await page.keyboard.press('Tab');
  await expect(folder('Archived')).toBeFocused();
  await expect(tab).toHaveText('important');
});

test('the keyboard walks the sidebar in focus order', async ({ page }) => {
  const { tab, folder } = await openWithSidebar(page);
  await folder('Inbox').focus();

  await page.keyboard.press('Tab');
  await expect(folder('Favorites')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(folder('Inbox')).toBeFocused();
  await expect(tab).toHaveText('important');

  // Tabbing on from a folder chosen with the mouse is still focus order once
  // the keyboard has moved focus.
  await folder('Favorites').click();
  await page.keyboard.press('Tab');
  await expect(folder('Archived')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(folder('Inbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(folder('Favorites')).toBeFocused();
  await expect(tab).toHaveText('important');
});

test("a project chosen in the sidebar with the mouse leaves Tab to the project's tabs", async ({
  page,
}) => {
  const { section, project } = await openWithSidebar(page);
  await project.click();
  await expect(
    page.getByRole('radiogroup', { name: 'Project sections' })
  ).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(section).toHaveText('tasks');
  await page.keyboard.press('3');
  await expect(section).toHaveText('notes');
  await page.keyboard.press('Shift+Tab');
  await expect(section).toHaveText('tasks');
});

test('a view chosen on the app rail leaves Tab to the header tabs', async ({
  page,
}) => {
  const { tab, section, folder, project, rail } = await openWithSidebar(page);
  // The rail hands the split back the folder the mouse last chose.
  await folder('Inbox').click();
  await rail.click();
  await page.keyboard.press('Tab');
  await expect(tab).toHaveText('noise');

  // From a project, the rail returns to Mail and its tabs.
  await project.click();
  await rail.click();
  await expect(page.getByRole('radiogroup', { name: 'Inbox view' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(tab).toHaveText('focus');
  await expect(section).toHaveText('overview');
});
