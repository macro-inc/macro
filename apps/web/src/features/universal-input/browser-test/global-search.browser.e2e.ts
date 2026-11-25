import { expect, type Page, test } from '@playwright/test';

async function compose(page: Page, text: string) {
  await page.goto('/?command-menu&eligible');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  await page.getByPlaceholder('Search...', { exact: true }).fill(text);
  await expect(
    page.getByRole('textbox', { name: 'Your input', exact: true })
  ).toBeFocused();
  return page.getByRole('dialog');
}

test('search messages from Julia writes its kind and sender into Search for, and waits for a word', async ({
  page,
}) => {
  const dialog = await compose(page, 'search all recent messages from julia');
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await expect(query).toHaveText('type:channel from:julia@macro.com');
  await expect(dialog.getByLabel('Search filters')).toHaveCount(0);
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  await expect(
    dialog.getByText('Add search text to search by sender or speaker.')
  ).toBeVisible();
  await query.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' budget');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"query":"type:channel from:julia@macro.com budget"'
  );
});

test('task search writes its status, priority, assignee and creator as operators before its words', async ({
  page,
}) => {
  const dialog = await compose(
    page,
    'search in progress high priority tasks assigned to julia created by john about android'
  );
  const operators =
    'type:task status:in_progress priority:high assignee:julia@macro.com author:john@example.com android';
  await expect(
    dialog.getByRole('textbox', { name: 'Search for', exact: true })
  ).toHaveText(operators);
  await expect(page.getByTestId('global-search-requests')).toContainText(
    `"query":"${operators}"`
  );
});

test('global Search requests carry the sender and the bound channel and render actual message snippets', async ({
  page,
}) => {
  const dialog = await compose(
    page,
    'search messages from julia in #sales about budget'
  );
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(
    dialog.getByRole('textbox', { name: 'Search for', exact: true })
  ).toHaveText('type:channel in:#sales from:julia@macro.com budget');
  await expect(results).toContainText('Julia shared the budget');
  await expect(results).not.toContainText('John reviewed');
  await expect(results.getByRole('option')).toHaveCount(1);
  await expect(results.locator('.soup-list-entity')).toHaveCount(1);
  // The channel goes by id; the sender is read from the text by the service.
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"query":"type:channel from:julia@macro.com budget"'
  );
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"channel_ids":["sales-channel"]'
  );
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  await input.press('ArrowDown');
  await input.press('Shift+Enter');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('opened-search-result')).toHaveText('');
  await expect(input.locator('p')).toHaveCount(2);
});

test('an edited Search for keeps its sender while later predictions change the draft', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from julia about budget');
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await expect(query).toHaveText('type:channel from:julia@macro.com budget');
  await query.fill('type:channel from:john@example.com forecast');
  await dialog
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('search messages from julia about forecast');
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(query).toHaveText('type:channel from:john@example.com forecast');
  await expect(results).toContainText('John reviewed the budget forecast');
  await expect(results).not.toContainText('Julia shared');
});

test('unresolved people do not issue an unfiltered search and can be corrected in Search for', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from Pat about budget');
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await expect(query).toHaveText('type:channel from:Pat budget');
  await expect(
    dialog.getByText('Choose a specific person or channel for Pat').first()
  ).toBeVisible();
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  // An edit that still names no one keeps holding the search.
  await query.fill('type:channel from:Pat budget plan');
  await expect(
    dialog.getByText('Choose a specific person or channel for Pat').first()
  ).toBeVisible();
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  await query.fill('type:channel from:julia@macro.com budget');
  await expect(
    dialog.getByRole('listbox', { name: 'Search results', exact: true })
  ).toContainText('Julia shared the budget');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"query":"type:channel from:julia@macro.com budget"'
  );
});

test('formatted main-input queries keep updating and search DMs use the full channel directory', async ({
  page,
}) => {
  const dialog = await compose(page, 'search all messages about __budget__');
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await expect(query).toContainText('budget');
  await input.fill('search messages about forecast');
  await expect(query).toHaveText('type:channel forecast');
  await input.fill('search messages in "Julia direct message" about budget');
  // The DM is bound to its id, so the name it is written with reaches it.
  await expect(query).toHaveText(
    'type:channel in:#"Julia direct message" budget'
  );
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"channel_ids":["julia-dm"]'
  );
});

test('the Documents filter rejects task hits from a full-text response', async ({
  page,
}) => {
  const dialog = await compose(page, 'search all my documents about Scope');
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(results).toContainText('Scope guide');
  await expect(results).not.toContainText('Scope task');
});

test('the shared global Search input keeps mention nodes when the host acknowledges the plain query', async ({
  page,
}) => {
  await page.goto('/?searchbar');
  const input = page.getByRole('textbox', {
    name: 'Standalone search',
    exact: true,
  });
  await expect(page.getByTestId('standalone-query-changes')).toHaveText('0');
  await page
    .getByRole('button', { name: 'Insert search mention', exact: true })
    .click();
  await expect(page.getByTestId('standalone-query')).toHaveText(
    'julia@macro.com budget'
  );
  await expect(input.locator('[data-user-mention]')).toHaveCount(1);
  await input.press('End');
  await page.keyboard.type(' forecast');
  await expect(page.getByTestId('standalone-query')).toHaveText(
    'julia@macro.com budget forecast'
  );
  await expect(input.locator('[data-user-mention]')).toHaveCount(1);
  const changes = await page
    .getByTestId('standalone-query-changes')
    .innerText();
  await page
    .getByRole('button', { name: 'Set external search', exact: true })
    .click();
  await expect(input).toHaveText('externally changed query');
  await expect(input.locator('[data-user-mention]')).toHaveCount(0);
  await expect(page.getByTestId('standalone-query-changes')).toHaveText(
    changes
  );
});

test('the shared global Search input keeps addresses it is given as text', async ({
  page,
}) => {
  await page.goto('/?searchbar');
  const input = page.getByRole('textbox', {
    name: 'Standalone search',
    exact: true,
  });
  await page
    .getByRole('button', { name: 'Set external address search', exact: true })
    .click();
  await expect(input).toHaveText(
    'comparison <ana@example.com> from:ana@example.com next'
  );
  await expect(input.locator('a')).toHaveCount(0);
  await input.press('End');
  await page.keyboard.type(' plan');
  await expect(page.getByTestId('standalone-query')).toHaveText(
    'comparison <ana@example.com> from:ana@example.com next plan'
  );
});

test('keeps typing in Search for in place while a sender is unresolved', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from Pat about budget');
  await expect(
    dialog.getByText('Choose a specific person or channel for Pat').first()
  ).toBeVisible();
  const query = dialog.getByRole('textbox', {
    name: 'Search for',
    exact: true,
  });
  await expect(query).toHaveText('type:channel from:Pat budget');
  await query.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plan', { delay: 80 });
  await expect(query).toHaveText('type:channel from:Pat budget plan');
});
