import { expect, type Page, test } from '@playwright/test';

async function chooseType(page: Page, name: string) {
  await page.getByLabel('Content type').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('saves an email only after Save as draft is clicked and refocuses without sending', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Email John that I will be late');
  const save = page.getByRole('button', { name: 'Save as draft', exact: true });
  await expect(save).toBeEnabled();
  await page
    .getByRole('textbox', { name: 'Subject', exact: true })
    .fill('Still working on this');
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('email-draft-count')).toHaveText('0');
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await save.click();
  await expect(page.getByTestId('email-draft-count')).toHaveText('1');
  await expect(page.getByTestId('last-email-draft')).toContainText(
    'Still working on this'
  );
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await expect(
    page.getByText('Email draft saved', { exact: true })
  ).toBeVisible();
  await expect(input).toHaveText('');
  await expect(input).toBeFocused();
});

test('adds an external email address with the shared recipient control and preserves manual addressing', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Email John that I’ll be late');
  const to = page.getByRole('combobox', { name: 'To', exact: true });
  await to.fill('external@example.org');
  await to.press('Enter');
  await expect(to).toHaveValue('');
  await page
    .getByRole('textbox', { name: 'Subject', exact: true })
    .fill('My subject');
  await input.fill('Email John with a changed thought');
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId('last-submission')).toContainText(
    'external@example.org'
  );
  await expect(page.getByTestId('last-submission')).toContainText('My subject');
});

test('chooses guests with the standard event picker and preserves them through inference', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Call John at 3pm tomorrow');
  await page.getByRole('button', { name: 'Guests', exact: true }).click();
  await expect(page.getByPlaceholder('Add guests...')).toBeVisible();
  await page
    .getByRole('menu')
    .getByText('John Adams', { exact: false })
    .click();
  await page.getByPlaceholder('Add guests...').press('Escape');
  await input.fill('Call John at 3pm tomorrow about the launch');
  const submit = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('last-submission')).toContainText(
    'john@example.com'
  );
});

test('edits a task through its rich title and description while later predictions preserve manual fields', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('notification clicks are broken');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await expect(title).toBeVisible();
  await title.fill('Route notification clicks');
  await title.press('Enter');
  const body = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(body).toBeFocused();
  await body.fill('Reproduce on mobile');
  await body.press('ControlOrMeta+a');
  await body.press('ControlOrMeta+b');
  await input.fill('notification clicks are broken, urgent');
  await expect(title).toHaveText('Route notification clicks');
  await expect(body.locator('strong, b')).toHaveText('Reproduce on mobile');
  await expect(title).toHaveText('Route notification clicks');
  await expect(body.locator('strong, b')).toHaveText('Reproduce on mobile');
  await expect(
    page.getByRole('button', { name: 'Create task', exact: true })
  ).toBeEnabled();
  await title.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('last-submission')).toContainText(
    '**Reproduce on mobile**'
  );
});

test('shows the note body, preserves manual formatting through predictions and submits it', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Research notes\nLaunch observations');
  const create = page.getByRole('button', { name: 'Create note', exact: true });
  await expect(create).toBeEnabled();
  const body = page.getByRole('textbox', { name: 'Note body', exact: true });
  await expect(body).toContainText('Research notes');
  await expect(body).toContainText('Launch observations');
  await expect(input).toBeFocused();
  await body.fill('Reviewed notes');
  await body.press('ControlOrMeta+a');
  await body.press('ControlOrMeta+b');
  await expect(body.locator('strong, b')).toContainText('Reviewed notes');
  await input.fill('Research notes\nNew observations');
  await expect(create).toBeEnabled();
  await expect(body).toHaveText('Reviewed notes');
  await expect(create).toBeEnabled();
  await expect(body.locator('strong, b')).toContainText('Reviewed notes');
  await create.click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-submission')).toContainText(
    '"body":"**Reviewed notes**"'
  );
  await expect(input).toHaveText('');
  await expect(input).toBeFocused();
});

test('preserves a manual body edit while model extraction supplies email addressing', async ({
  page,
}) => {
  await page.goto('/?extract-delay=1200');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Email John\nCan we reschedule tomorrow?');
  await expect(page.getByLabel('Content type')).toHaveText('Auto · Email', {
    timeout: 800,
  });
  const body = page.getByLabel('Outgoing message');
  await expect(body).toContainText('Can we reschedule tomorrow?', {
    timeout: 800,
  });
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeDisabled();
  await expect(input).toBeFocused();
  await body.click();
  await body.fill('My message to John');
  await input.fill('Email John\nA different proposed body');
  await expect(body).toHaveText('My message to John');
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  await expect(body).toHaveText('My message to John');
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});

test('predicts a new type while the previous extraction is still running', async ({
  page,
}) => {
  await page.goto('/?extract-delay=3000');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('notification clicks are broken');
  await expect(page.getByTestId('extraction-count')).toHaveText('1');
  await input.fill('Research notes about launch dates');
  await expect(page.getByLabel('Content type')).toHaveText('Auto · Note', {
    timeout: 1200,
  });
  await expect(page.getByTestId('classification-count')).toHaveText('2');
  await expect(page.getByTestId('extraction-count')).toHaveText('1');
  await expect(page.getByLabel('Title', { exact: true })).toHaveText(
    'Research notes about launch dates'
  );
  await expect(input).toBeFocused();
  await expect(page.getByTestId('extraction-count')).toHaveText('2');
  await expect(page.getByLabel('Title', { exact: true })).toHaveText(
    'Research notes about launch dates'
  );
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});

test('starts blank and preserves the editor, focus, caret and undo as calendar fields appear', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await expect(input).toHaveText('');
  await expect(input).not.toHaveAttribute('placeholder');
  await input.evaluate((element) => {
    element.setAttribute('data-original', 'true');
  });
  await input.pressSequentially('Call John at 3pm tomorrow');
  await expect(
    page.getByRole('button', { name: 'Create event', exact: true })
  ).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('data-original', 'true');
  expect(await input.evaluate(() => window.getSelection()?.anchorOffset)).toBe(
    'Call John at 3pm tomorrow'.length
  );
  await expect(
    page.getByRole('combobox', { name: 'event start time', exact: true })
  ).toHaveValue('3:00 PM');
  await expect(
    page.getByRole('button', { name: 'Guests', exact: true })
  ).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveText('Call John at 3pm tomorrow\n');
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveText('Call John at 3pm tomorrow');
  await expect(
    page.getByRole('button', { name: 'Create event', exact: true })
  ).toBeEnabled();
});

test('locks edited fields and submits the visible event once', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Call John at 3pm tomorrow');
  const submit = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await page.getByLabel('Title', { exact: true }).fill('Call Jane');
  await expect(page.getByLabel('Content type')).toHaveText('Event');
  await input.fill('Email John instead');
  await expect(submit).toBeEnabled();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Call Jane'
  );
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Call Jane'
  );
  await expect(submit).toBeEnabled();
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-submission')).toContainText('Call Jane');
  await expect(input).toHaveText('');
});

test('shows outgoing email content and recipient before sending', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Email John that I’ll be late');
  await expect(
    page.getByRole('button', { name: 'Send email', exact: true })
  ).toBeEnabled();
  await expect(page.getByLabel('Outgoing message')).toHaveText('I’ll be late');
  await expect(page.getByText('John Adams', { exact: true })).toBeVisible();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-submission')).toContainText(
    'I’ll be late'
  );
  await expect(
    page.getByRole('textbox', { name: 'Your input', exact: true })
  ).toHaveText('');
});

for (const example of [
  { text: 'Email John that I’ll be late', action: 'Send email' },
  { text: 'Call John at 3pm tomorrow', action: 'Create event' },
]) {
  test(`connects Google before ${example.action} and keeps the draft`, async ({
    page,
  }) => {
    await page.goto('/?disconnected');
    const input = page.getByRole('textbox', {
      name: 'Your input',
      exact: true,
    });
    await input.fill(example.text);
    const submit = page.getByRole('button', {
      name: example.action,
      exact: true,
    });
    await expect(submit).toBeDisabled();
    await page
      .getByRole('button', { name: 'Connect Google', exact: true })
      .click();
    await expect(page.getByTestId('connection-count')).toHaveText('1');
    await expect(input).toHaveText(example.text);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId('submission-count')).toHaveText('1');
    await expect(input).toHaveText('');
  });
}

test('chooses a close-scoring task during typing and cycles alternatives without losing editor focus', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await expect(input).toBeVisible();
  const typing = input.pressSequentially(
    'notification click not going to target',
    { delay: 60 }
  );
  await expect(page.getByLabel('Content type')).toHaveText('Auto · Task');
  expect((await input.textContent())?.length).toBeLessThan(
    'notification click not going to target'.length
  );
  await typing;
  await input.press('ControlOrMeta+Shift+ArrowRight');
  await expect(page.getByLabel('Content type')).toHaveText('Note');
  await expect(input).toBeFocused();
  await input.press('ControlOrMeta+Shift+ArrowLeft');
  await expect(page.getByLabel('Content type')).toHaveText('Task');
});

test('shows the AM/PM assumption and lets a manual start edit override it', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('call with Julia tomorrow at 7');
  const start = page.getByRole('combobox', {
    name: 'event start time',
    exact: true,
  });
  await expect(start).toHaveValue('7:00 PM');
  await expect(
    page.getByText('Assumed 7:00 PM for', { exact: false })
  ).toBeVisible();
  await start.click();
  const time = start;
  await time.fill('07:00');
  await time.press('Enter');
  await time.press('Escape');
  await expect(
    page.getByText('Assumed 7:00 PM for', { exact: false })
  ).not.toBeVisible();
  await expect(start).toHaveValue('7:00 AM');
  await expect(
    page.getByRole('switch', { name: 'All day', exact: true })
  ).toHaveCount(0);
});

test('keeps note tags with the draft through inference, switching types', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Research notes');
  await page
    .getByRole('button', { name: 'Change or select tags', exact: true })
    .click();
  await page.getByText('Launch', { exact: true }).click();
  await input.click();
  await input.fill('Research notes with more detail');
  await expect(
    page.getByRole('button', { name: 'Change or select tags', exact: true })
  ).toContainText('Launch');
  await chooseType(page, 'Task');
  await chooseType(page, 'Note');
  await expect(
    page.getByRole('button', { name: 'Change or select tags', exact: true })
  ).toContainText('Launch');
  await expect(
    page.getByRole('button', { name: 'Change or select tags', exact: true })
  ).toContainText('Launch');
  const send = page.getByRole('button', { name: 'Create note', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId('last-submission')).toContainText('launch');
});

test('uses the shared AI picker and exposes its real connection and creation actions', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Help me plan the launch');
  await chooseType(page, 'AI');
  const picker = page.getByRole('button', { name: 'Agent', exact: true });
  await picker.click();
  await page.getByRole('menuitem', { name: /Cursor/ }).click();
  await expect(page.getByTestId('agent-action')).toContainText('connect:');
  await picker.click();
  await page
    .getByRole('menuitem', { name: 'Create agent', exact: true })
    .click();
  await expect(page.getByTestId('agent-action')).toHaveText('create');
});

test('uses the shared legacy model picker and submits the chosen model', async ({
  page,
}) => {
  await page.goto('/?legacy');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Help me plan the launch');
  await chooseType(page, 'AI');
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('menuitem', { name: /GPT-5/ }).click();
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('last-submission')).toContainText('gpt-5');
});

test('global Search uses its own rows and keeps manual queries while the draft changes', async ({
  page,
}) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('find hiring');
  const query = page.getByRole('textbox', { name: 'Search for', exact: true });
  await query.fill('investor');
  await input.fill('find hiring plan');
  const results = page.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  const match = results.getByRole('option', {
    name: 'Investor update',
    exact: true,
  });
  await expect(match).toBeVisible();
  await expect(match.locator('.soup-list-entity')).toHaveCount(1);
  await expect(results.getByRole('option')).toHaveCount(1);
  await query.press('ArrowDown');
  await expect(match).toHaveAttribute('aria-selected', 'true');
  await query.press('Enter');
  await expect(page.getByTestId('opened-search-result')).toContainText(
    'search-document-0'
  );
});

test('Command K still searches, opens its selected result, and closes the modal', async ({
  page,
}) => {
  await page.goto('/?command-menu&eligible');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  const search = page.getByPlaceholder('Search...', { exact: true });
  await expect(search).toBeFocused();
  await search.fill('investor');
  const results = page.getByRole('listbox', {
    name: 'Search results',
    exact: true,
  });
  await expect(
    results.getByRole('option', { name: 'Investor update', exact: true })
  ).toBeVisible();
  await expect(results.getByRole('option', { selected: true })).toHaveText(
    'Investor update'
  );
  await search.press('Enter');
  await expect(page.getByTestId('opened-search-result')).toHaveText(
    JSON.stringify({
      content: { type: 'md', id: 'search-document-0' },
      options: { referredFrom: 'kommand-menu', preferNewSplit: false },
    })
  );
  await expect(search).not.toBeVisible();
});

test('uses shared copy-recipient controls and preserves a manual Bcc through inference', async ({
  page,
}) => {
  await page.goto('/?copies');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Email John that I’ll be late');
  await expect(
    page.getByText('julia@example.com', { exact: true })
  ).toBeVisible();
  const bcc = page.getByRole('combobox', { name: 'Bcc', exact: true });
  await expect(bcc).toBeVisible();
  await bcc.fill('private@example.org');
  await bcc.press('Enter');
  await input.fill('Email John that I’ll be late with a changed thought');
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  const submission = page.getByTestId('last-submission');
  await expect(submission).toContainText('julia@example.com');
  await expect(submission).toContainText('investor@example.org');
  await expect(submission).toContainText('private@example.org');
});

test('uses the shared recurrence selector and preserves a manual one-off choice', async ({
  page,
}) => {
  await page.goto('/?recurrence');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Call John at 3pm tomorrow');
  await expect(
    page.getByRole('button', { name: 'Create event', exact: true })
  ).toBeEnabled();
  const repeats = page.getByRole('button', { name: /Repeats/ });
  await expect(repeats).toBeVisible();
  await repeats.click();
  await page
    .getByRole('option', { name: 'Does not repeat', exact: true })
    .click();
  await input.fill('Call John at 3pm tomorrow about the launch');
  const create = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByTestId('last-submission')).toContainText(
    '"recurrence":""'
  );
});

test('keeps a manual weekly rule visible and submitted after moving the event start day', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Call John at 3pm tomorrow');
  const create = page.getByRole('button', {
    name: 'Create event',
    exact: true,
  });
  await expect(create).toBeEnabled();
  const repeats = page.getByRole('button', { name: /^Repeats/ });
  await repeats.click();
  await page
    .getByRole('option', { name: 'Weekly on Saturday', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Edit event start date',
      exact: true,
    })
    .click();
  await page.getByRole('gridcell', { name: '11', exact: true }).click();
  await expect(repeats).toContainText('Custom');
  await expect(
    page.getByRole('button', { name: 'SA', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'SU', exact: true })
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByTestId('last-submission')).toContainText('SA');
});

test('keeps a partially typed Cc address while inference updates unrelated fields', async ({
  page,
}) => {
  await page.goto('/?copies&extract-delay=300');
  const input = page.getByRole('textbox', { name: 'Your input', exact: true });
  await input.fill('Email John that I’ll be late');
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeEnabled();
  const cc = page.getByRole('combobox', { name: 'Cc', exact: true });
  const before = Number(
    await page.getByTestId('extraction-count').textContent()
  );
  await cc.pressSequentially('private', { delay: 80 });
  await expect(page.getByTestId('extraction-count')).not.toHaveText(
    String(before)
  );
  await expect(cc).toHaveValue('private');
  await cc.pressSequentially('@example.org', { delay: 80 });
  await expect(cc).toHaveValue('private@example.org');
  await cc.press('Enter');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId('last-submission')).toContainText(
    'private@example.org'
  );
});

test('keeps Command K open while searching and choosing an AI model', async ({
  page,
}) => {
  await page.goto('/?command-menu&eligible&legacy&classification=ai');
  await page
    .getByRole('button', { name: 'Open Command K', exact: true })
    .click();
  const text = 'Help me plan the launch';
  await page.getByPlaceholder('Search...', { exact: true }).fill(text);
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', {
    name: 'Your input',
    exact: true,
  });
  await expect(input).toHaveText(text);
  const picker = dialog.getByRole('button', { name: 'Model', exact: true });
  await picker.click();
  const search = page.getByRole('textbox', {
    name: 'Search models',
    exact: true,
  });
  await search.fill('GPT-5');
  await page
    .getByRole('menuitem', { name: /GPT-5/ })
    .or(page.getByRole('radio', { name: /GPT-5/ }))
    .click();
  await expect(search).not.toBeVisible();
  await expect(input).toHaveText(text);
  await picker.click();
  await search.click();
  await search.press('Escape');
  await expect(search).not.toBeVisible();
  await expect(input).toBeVisible();
  await input.click();
  await expect(input).toBeFocused();
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('command-submission-count')).toHaveText('1');
  await expect(page.getByTestId('last-command-submission')).toContainText(
    'gpt-5'
  );
  await expect(input).not.toBeVisible();
});

test('selects an event end after midnight through the shared time control', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Your input', exact: true })
    .fill('Call John at 3pm tomorrow');
  const end = page.getByRole('combobox', {
    name: 'event end time',
    exact: true,
  });
  await expect(end).toHaveValue('4:00 PM');
  await end.fill('1am');
  await end.press('Enter');
  await expect(end).toHaveValue('1:00 AM');
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  await expect(page.getByTestId('last-submission')).toContainText(
    '"end":"2026-10-11T01:00"'
  );
});
