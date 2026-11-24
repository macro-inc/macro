import { expect, type Page, test } from '@playwright/test';

// Synthetic owner data; exercise the real settings, query and decision layers.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    ['fetch', 'xhr'].includes(route.request().resourceType())
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{}',
        })
      : route.continue()
  );
  await page.route('https://**', (route) => route.abort());
  await page.routeWebSocket('**/*', (socket) => socket.close());
});

async function openSettings(page: Page, query: string) {
  await page.goto(query);
  // The fixture dynamically imports the shared app graph after Prism.
  await expect(page.getByTestId('policy-calls')).toBeAttached({
    timeout: 30_000,
  });
}

test('read-only overview, aligned rule kinds, automatic validation and verified history', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing');
  await expect(
    page.getByRole('heading', { name: 'Sharing rules', exact: true })
  ).toBeVisible();
  const calls = page.getByTestId('policy-calls');
  await expect(calls).not.toContainText('replace');
  await expect(calls).not.toContainText('validate');
  await expect(page.getByText(/Updated by your agent/i)).toBeVisible();
  const company = page.getByText('Company', { exact: true });
  const description = page.getByText(
    'Current company domains only. Add people with contact rules.',
    { exact: true }
  );
  await description.scrollIntoViewIfNeeded();
  const labelBox = await company.boundingBox();
  const descriptionBox = await description.boundingBox();
  expect(labelBox).toBeTruthy();
  expect(descriptionBox).toBeTruthy();
  expect(labelBox!.y).toBeLessThan(descriptionBox!.y + descriptionBox!.height);
  await page.getByRole('button', { name: 'Edit JSON', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Validate', exact: true })
  ).toHaveCount(0);
  const draft = page.getByRole('textbox', { name: 'Sharing rules JSON' });
  await expect(draft).toHaveValue(
    /^\{\n {2}"schema_version": 1,\n {2}"include": \[/
  );
  await draft.fill(JSON.stringify(JSON.parse(await draft.inputValue())));
  await page
    .getByRole('button', { name: 'Save and share', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: /saved/ })
  ).toBeVisible();
  await expect(draft).toHaveValue(
    /^\{\n {2}"schema_version": 1,\n {2}"include": \[/
  );
  const sequence: string[] = JSON.parse((await calls.textContent()) ?? '[]');
  expect(sequence).toContain('validate');
  expect(sequence).toContain('replace');
  expect(sequence.indexOf('validate')).toBeLessThan(
    sequence.indexOf('replace')
  );
  await page.getByRole('button', { name: 'CRM', exact: true }).last().click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText(/your agent/i)).toBeVisible();
  await expect(page.getByText(/You ·/).first()).toBeVisible();
  await page
    .getByRole('button', { name: 'View rules', exact: true })
    .first()
    .click();
  await expect(page.locator('pre')).toContainText('schema_version');
  await expect(
    page.getByRole('textbox', { name: 'Sharing rules JSON' })
  ).toHaveCount(0);
});

test('keeps the open sharing draft through CRM access retirement', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&retirement');
  await page.getByRole('button', { name: 'Edit JSON', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Sharing rules JSON' });
  const edited =
    '{"schema_version":1,"include":[{"kind":"domain","domain":"draft.example.com"}]}';
  await draft.fill(edited);
  await page.getByRole('button', { name: 'Retire CRM cache' }).click();
  await expect(page.getByTestId('retirement-complete')).toHaveText('true');
  await expect(draft).toHaveValue(edited);
  await expect(page.getByTestId('policy-calls')).not.toContainText('replace');
});

for (const pending of ['policy-pending', 'policy-flag-pending']) {
  test(`${pending} retains the overview layout`, async ({ page }) => {
    await openSettings(page, `/?selective-settings&contributing&${pending}`);
    const loading = page.getByRole('status').filter({
      hasText: 'Loading email settings…',
    });
    await expect(loading).toBeVisible();
    await expect(page.locator('[data-settings-page]')).toBeVisible();
    await expect(
      page.getByText(
        'Manage email sharing and shape your team’s deal pipeline.'
      )
    ).toBeVisible();
    expect(
      await loading.evaluate((element) =>
        Boolean(element.closest('[data-settings-page]'))
      )
    ).toBe(true);
    if (pending === 'policy-pending') {
      await page.getByRole('button', { name: 'Finish policy load' }).click();
      await expect(
        page.getByRole('heading', { name: 'Sharing rules', exact: true })
      ).toBeVisible();
    }
  });
}

test('pending exclusions do not appear empty while sharing rules are available', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&privacy-pending');
  await expect(
    page.getByRole('heading', { name: 'Sharing rules', exact: true })
  ).toBeVisible();
  await expect(page.getByText('Loading email settings…')).toBeVisible();
  await expect(page.getByText('No domains blocked.')).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Domain to block for the team' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish privacy load' }).click();
  await expect(
    page.getByText('team.example.com', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('personal.example.com', { exact: true })
  ).toBeVisible();
});

test('failed exclusions offer retry without claiming an empty blocklist', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&privacy-retry');
  await expect(
    page.getByText('Email settings could not be loaded.')
  ).toBeVisible();
  await expect(page.getByText('No domains blocked.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('team.example.com', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('personal.example.com', { exact: true })
  ).toBeVisible();
});

test('a failed exclusion refresh retains the last known blocklists', async ({
  page,
}) => {
  await openSettings(
    page,
    '/?selective-settings&contributing&privacy-refresh-failed'
  );
  await page
    .getByRole('textbox', { name: 'Domain to block for the team' })
    .fill('added.example.com');
  await page
    .getByRole('button', { name: 'Add domain', exact: true })
    .first()
    .click();
  await expect(
    page.getByText('Email settings could not be loaded.')
  ).toBeVisible();
  await expect(
    page.getByText('team.example.com', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('added.example.com', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('personal.example.com', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toBeVisible();
  await expect(page.getByText('No domains blocked.')).toHaveCount(0);
});

test('a conflict retains the draft until the member inspects and accepts current rules', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&conflict');
  await page.getByRole('button', { name: 'Edit JSON', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Sharing rules JSON' });
  const json =
    '{"schema_version":1,"include":[{"kind":"domain","domain":"draft.example.com"}]}';
  await draft.fill(json);
  const save = page.getByRole('button', {
    name: 'Save and share',
    exact: true,
  });
  await save.click();
  await expect(
    page.getByRole('heading', { name: 'Sharing changed since you opened this' })
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(draft).toHaveValue(json);
  await expect(save).toBeDisabled();
  const sequence: string[] = JSON.parse(
    (await page.getByTestId('policy-calls').textContent()) ?? '[]'
  );
  expect(sequence.filter((call) => call === 'replace')).toHaveLength(1);
  await page
    .getByRole('button', { name: 'View current rules', exact: true })
    .click();
  await expect(
    page.getByText('partner.example.com', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /I reviewed these rules/ }).click();
  await expect(draft).toHaveValue(json);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole('status').filter({ hasText: /saved/ })
  ).toBeVisible();
  await expect(draft).toHaveValue(JSON.stringify(JSON.parse(json), null, 2));
});

test('limit refusals stay inline and do not save', async ({ page }) => {
  await openSettings(page, '/?selective-settings&contributing&limit');
  await page.getByRole('button', { name: 'Edit JSON', exact: true }).click();
  await page
    .getByRole('button', { name: 'Save and share', exact: true })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    'Rule discovery limit exceeded: 2000 addresses.'
  );
  await expect(page.getByTestId('policy-calls')).not.toContainText('replace');
});

test('gate off retains selected rules, history and single-action withdrawal', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&policy-gate-off');
  await expect(
    page.getByRole('heading', { name: 'Sharing rules', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit JSON', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Preview counts', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'History', exact: true })
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Stop sharing my emails', exact: true })
    .click();
  await expect(page.getByTestId('last-change')).toHaveText(
    '{"action":"set_consent","enabled":false}'
  );
});

test('a disconnected mailbox connects without enabling selected sharing', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&disconnected');
  await expect(page.getByText('No email connected')).toBeVisible();
  const connect = page.getByRole('button', {
    name: 'Connect email',
    exact: true,
  });
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('member@example.com')).toBeVisible();
  await expect(connect).toHaveCount(0);
  await expect(
    page.getByText('Your emails are not contributing to CRM.')
  ).toBeVisible();
  await expect(page.getByTestId('policy-calls')).not.toContainText('replace');
  await expect(page.getByTestId('last-change')).toHaveText('');
});

test('gate off preserves the legacy all-mail settings', async ({ page }) => {
  await openSettings(
    page,
    '/?selective-settings&contributing&policy-gate-off&all-mail'
  );
  await expect(
    page.getByRole('button', { name: 'Stop sharing my emails', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sharing rules', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Preview counts', exact: true })
  ).toHaveCount(0);
});

test('unavailable policy prevents enabling sharing and retains withdrawal', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&policy-unavailable');
  await expect(
    page.getByRole('button', { name: 'Share my emails with CRM', exact: true })
  ).toBeDisabled();
  await expect(page.getByTestId('last-change')).toBeEmpty();
  await openSettings(
    page,
    '/?selective-settings&policy-unavailable&contributing'
  );
  await page
    .getByRole('button', { name: 'Stop sharing my emails', exact: true })
    .click();
  await expect(page.getByTestId('last-change')).toContainText(
    '"enabled":false'
  );
});

test('preview is explicit, count-only and never activates sharing', async ({
  page,
}) => {
  await openSettings(page, '/?selective-settings&contributing&partial');
  await page
    .getByRole('button', { name: 'Preview counts', exact: true })
    .click();
  await expect(page.getByTestId('policy-calls')).not.toContainText(
    'start-preview'
  );
  await page.getByRole('button', { name: 'Run preview', exact: true }).click();
  await expect(page.getByText('At least 214', { exact: true })).toBeVisible();
  const calls = page.getByTestId('policy-calls');
  const before: string[] = JSON.parse((await calls.textContent()) ?? '[]');
  await page
    .getByRole('button', { name: 'Refresh counts', exact: true })
    .click();
  await expect(calls).not.toHaveText(JSON.stringify(before));
  const after: string[] = JSON.parse((await calls.textContent()) ?? '[]');
  expect(after.filter((call) => call === 'preview').length).toBeGreaterThan(
    before.filter((call) => call === 'preview').length
  );
  await expect(page.getByTestId('policy-calls')).not.toContainText('replace');
});
