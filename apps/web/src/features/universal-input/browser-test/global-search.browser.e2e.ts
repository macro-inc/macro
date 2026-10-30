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

test('search messages from Julia prepopulates the global Channels and From facets, including a filter-only search', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from julia');
  await expect(
    dialog.getByLabel('Search filters').getByText('Channels', { exact: true })
  ).toBeVisible();
  await expect(
    dialog
      .getByLabel('Search filters')
      .getByText('Julia Jones', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByRole('textbox', { name: 'Search for', exact: true })
  ).toHaveText('');
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  await expect(
    dialog.getByText(
      'Add at least 3 search characters to search by sender or speaker.'
    )
  ).toBeVisible();
  await dialog
    .getByRole('textbox', { name: 'Search for', exact: true })
    .fill('budget');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"sender_ids":["macro|julia@macro.com"]'
  );
});

test('task search applies status, priority, assignee and creator facets without repeating them as keywords', async ({
  page,
}) => {
  const dialog = await compose(
    page,
    'search in progress high priority tasks assigned to julia created by john about android'
  );
  const filters = dialog.getByLabel('Search filters');
  await expect(filters.getByText('Tasks', { exact: true })).toBeVisible();
  await expect(filters.getByText('In Progress', { exact: true })).toBeVisible();
  await expect(filters.getByText('High', { exact: true })).toBeVisible();
  await expect(filters.getByText('Julia Jones', { exact: true })).toBeVisible();
  await expect(filters.getByText('John Adams', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('textbox', { name: 'Search for', exact: true })
  ).toHaveText('android');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    'macro|julia@macro.com'
  );
  await expect(page.getByTestId('global-search-requests')).toContainText(
    'macro|john@example.com'
  );
});

test('global Search requests enforce sender and channel filters and render actual message snippets', async ({
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
  await expect(results).toContainText('Julia shared the budget');
  await expect(results).not.toContainText('John reviewed');
  await expect(results.getByRole('option')).toHaveCount(1);
  await expect(results.locator('.soup-list-entity')).toHaveCount(1);
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"sender_ids":["macro|julia@macro.com"]'
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

test('manual sender choices override later predictions while the search query continues updating', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from julia about budget');
  await expect(dialog.getByText('Julia Jones', { exact: true })).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Clear From filter', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Change From filter', exact: true })
    .click();
  await page.getByRole('option', { name: 'John Adams', exact: true }).click();
  await expect(
    page.getByRole('option', { name: 'John Adams', exact: true })
  ).toHaveCount(0);
  await dialog
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('search messages from julia about forecast');
  const results = dialog.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(
    dialog.getByRole('textbox', { name: 'Search for', exact: true })
  ).toHaveText('forecast');
  await expect(results).toContainText('John reviewed the budget forecast');
  await expect(results).not.toContainText('Julia shared');
  await expect(
    dialog.getByLabel('Search filters').getByText('John Adams', { exact: true })
  ).toBeVisible();
});

test('unresolved people do not issue an unfiltered search and can be corrected with the From picker', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages from Pat about budget');
  await expect(
    dialog.getByText('Choose a specific person or channel for Pat').first()
  ).toBeVisible();
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  await dialog
    .getByRole('button', { name: 'Change From filter', exact: true })
    .click();
  await page.getByRole('option', { name: 'Julia Jones', exact: true }).hover();
  await page
    .getByRole('button', { name: 'Select only Julia Jones', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('option', { name: 'Julia Jones', exact: true })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('listbox', { name: 'Search results', exact: true })
  ).toContainText('Julia shared the budget');
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"sender_ids":["macro|julia@macro.com"]'
  );
});

test('formatted main-input queries keep updating and search DMs use the full channel directory', async ({
  page,
}) => {
  const dialog = await compose(page, 'search messages about __budget__');
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
  await expect(query).toHaveText('forecast');
  await input.fill('search messages in "Julia direct message" about budget');
  await expect(
    dialog
      .getByLabel('Search filters')
      .getByText('Julia direct message', { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('global-search-requests')).toContainText(
    '"channel_ids":["julia-dm"]'
  );
});

test('the Documents filter rejects task hits from a full-text response', async ({
  page,
}) => {
  const dialog = await compose(page, 'search documents about Scope');
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

test('keeps Search facet text centered and unclipped inside each segment', async ({
  page,
}) => {
  const dialog = await compose(
    page,
    'search in progress high priority tasks assigned to julia created by john about android'
  );
  const filters = dialog.getByLabel('Search filters');
  await expect(filters.getByText('Tasks', { exact: true })).toBeVisible();
  await expect(filters.getByText('High', { exact: true })).toBeVisible();
  const bounds = await filters.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const frame = button.closest('[role="group"]')!.getBoundingClientRect();
      const segment = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      return {
        label: button.textContent || button.getAttribute('aria-label'),
        segmentTop: segment.top,
        segmentBottom: segment.bottom,
        textTop: text.top,
        textBottom: text.bottom,
        frameTop: frame.top,
        frameBottom: frame.bottom,
        centerOffset: Math.abs(
          segment.top + segment.height / 2 - frame.top - frame.height / 2
        ),
      };
    })
  );
  expect(bounds.length).toBeGreaterThan(0);
  for (const bound of bounds) {
    expect(bound.segmentTop, String(bound.label)).toBeGreaterThanOrEqual(
      bound.frameTop
    );
    expect(bound.segmentBottom, String(bound.label)).toBeLessThanOrEqual(
      bound.frameBottom
    );
    expect(bound.textTop, String(bound.label)).toBeGreaterThanOrEqual(
      bound.frameTop
    );
    expect(bound.textBottom, String(bound.label)).toBeLessThanOrEqual(
      bound.frameBottom
    );
    expect(bound.centerOffset, String(bound.label)).toBeLessThanOrEqual(1);
  }
  await filters
    .getByRole('button', { name: 'Clear Priority filter', exact: true })
    .click();
  await expect(
    filters.getByText('Any priority', { exact: true })
  ).toBeVisible();
});
