import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      !url.pathname.startsWith('/__macro_dev/')
    )
      await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.routeWebSocket('**/*', async (socket) => {
    const url = new URL(socket.url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname))
      socket.connectToServer();
    else await socket.close();
  });
});

for (const mode of ['email', 'calendar']) {
  test(`${mode} inference preserves ambiguity and resolves full names beyond the suggestion window`, async ({
    page,
  }) => {
    await page.goto(`/?person-references&classification=${mode}`);
    const prompt = page.getByRole('textbox', {
      name: 'Your input',
      exact: true,
    });
    const prefix = mode === 'email' ? 'Email' : 'Invite';
    const submit = page.getByRole('button', {
      name: mode === 'email' ? 'Send email' : 'Create event',
      exact: true,
    });
    await prompt.fill(`${prefix} Ambiguous`);
    await expect(page.getByTestId('people-reference-terms')).toHaveText(
      '["ambiguous"]'
    );
    await expect(page.getByTestId('people-reference-status')).toHaveText(
      'ready'
    );
    await expect(submit).toBeDisabled();
    if (mode === 'email')
      await expect(
        page.getByRole('button', { name: 'Save as draft', exact: true })
      ).toBeDisabled();
    await prompt.fill(`${prefix} Precise`);
    await expect(page.getByTestId('people-reference-result')).toContainText(
      'macro|precise@example.com'
    );
    await expect(submit).toBeEnabled();
    await prompt.fill(`${prefix} Family, Given`);
    await expect(page.getByTestId('people-reference-terms')).toHaveText(
      '["family, given"]'
    );
    await expect(page.getByTestId('people-reference-result')).toContainText(
      'macro|family-given@example.com'
    );
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId('person-targets')).toContainText(
      'macro|family-given@example.com'
    );
    await expect(page.getByTestId('person-targets')).not.toContainText(
      'macro|family@example.com'
    );
    await expect(page.getByTestId('person-targets')).not.toContainText(
      'macro|given@example.com'
    );
    await expect(page.getByTestId('person-targets')).not.toContainText(
      'macro|other@example.com'
    );
  });
}

test('message choices keep their names while independent identity proof loads', async ({
  page,
}) => {
  await page.goto('/?person-references&classification=message');
  const prompt = page.getByRole('textbox', { name: 'Your input', exact: true });
  await prompt.fill('DM Ambiguous');
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  const submit = page.getByRole('button', {
    name: 'Send message',
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Pause identity lookups' }).click();
  const to = page.getByRole('combobox', {
    name: 'To person or channel',
    exact: true,
  });
  // Remove the unresolved inferred chip before making an explicit choice.
  await to.press('Backspace');
  await to.fill('late');
  await expect(page.getByRole('option', { name: /Late Person/ })).toBeVisible();
  await to.press('Enter');
  await expect(page.getByTestId('people-reference-status')).toHaveText(
    'loading'
  );
  await expect(page.getByText('Late Person', { exact: true })).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: 'Resume identity lookups' }).click();
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await expect(submit).toBeEnabled();
  await prompt.fill('DM Ambiguous again');
  await expect(page.getByText('Late Person', { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('person-targets')).toContainText(
    'macro|late@example.com'
  );
});

test('email Cc and Bcc pickers search independently and preserve selected labels', async ({
  page,
}) => {
  await page.goto('/?person-references&classification=email');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Email target@example.com');
  await page.getByRole('button', { name: 'Cc/Bcc', exact: true }).click();
  const cc = page.getByRole('combobox', { name: 'Cc', exact: true });
  await cc.fill('late');
  await expect(page.getByRole('option', { name: /Late Person/ })).toBeVisible();
  await cc.press('Enter');
  const bcc = page.getByRole('combobox', { name: 'Bcc', exact: true });
  await bcc.fill('precise');
  await page.getByRole('option', { name: /precise@example\.com/ }).click();
  await expect(page.getByText('Late Person', { exact: true })).toBeVisible();
  await expect(page.getByText('Precise', { exact: true })).toBeVisible();
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.getByTestId('person-targets')).toContainText(
    'late@example.com'
  );
  await expect(page.getByTestId('person-targets')).toContainText(
    'precise@example.com'
  );
  await expect(page.getByTestId('person-targets')).toContainText(
    'target@example.com'
  );
});

test('a complete email address is not redirected by a contact display-name alias', async ({
  page,
}) => {
  await page.goto('/?person-references&classification=email');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Email target@example.com');
  await expect(page.getByTestId('people-reference-terms')).toHaveText(
    '["target@example.com"]'
  );
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.getByTestId('person-targets')).toContainText(
    '"email":"target@example.com"'
  );
  await expect(page.getByTestId('person-targets')).not.toContainText(
    'alias@example.com'
  );
});

test('incomplete offline name evidence blocks sending and resolves the same draft on reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/?person-references&classification=email');
  const prompt = page.getByRole('textbox', { name: 'Your input', exact: true });
  await prompt.fill('Email Ambiguous');
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await context.setOffline(true);
  await prompt.fill('Email Late Person');
  await expect(page.getByTestId('people-reference-terms')).toHaveText(
    '["late person"]'
  );
  await expect(page.getByTestId('people-reference-status')).toHaveText(
    'incomplete'
  );
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  await expect(page.getByTestId('people-reference-result')).toContainText(
    'macro|late@example.com'
  );
});

test('inferred search cannot run with an unresolved person constraint', async ({
  page,
}) => {
  await page.goto('/?person-references&classification=search');
  const prompt = page.getByRole('textbox', { name: 'Your input', exact: true });
  await prompt.fill('Search Ambiguous');
  await expect(page.getByTestId('people-reference-terms')).toHaveText(
    '["ambiguous"]'
  );
  await expect(page.getByTestId('people-reference-status')).toHaveText('ready');
  await expect(page.getByTestId('global-search-requests')).toHaveText('[]');
  await prompt.fill('Search Precise');
  await expect(page.getByTestId('people-reference-result')).toContainText(
    'macro|precise@example.com'
  );
  await expect(page.getByTestId('global-search-requests')).toContainText(
    'macro|precise@example.com'
  );
});
