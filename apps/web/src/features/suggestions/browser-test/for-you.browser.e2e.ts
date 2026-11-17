import { expect, type Page, test } from '@playwright/test';

const card = (page: Page, id: string) =>
  page.locator(`[data-suggestion="${id}"]`);
const requests = (page: Page) => page.getByRole('list', { name: 'Requests' });

for (const theme of ['dark', 'light']) {
  test(`every kind and state of suggestion shows as a row in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);

    await expect(page.locator('[data-suggestion]')).toHaveCount(9);
    await expect(card(page, 'suggestion-failed')).toHaveAttribute(
      'data-suggestion-status',
      'failed'
    );
    await expect(card(page, 'suggestion-running')).toHaveAttribute(
      'data-suggestion-status',
      'running'
    );
    // A finished suggestion is one quiet row under Done today.
    await expect(card(page, 'suggestion-done')).toContainText('Open result');
    // What a run will post is on the card before Run.
    await expect(
      card(page, 'suggestion-background').locator('[data-suggestion-sends]')
    ).toHaveText('Posts the weekly status summary in #ops');
    await expect(
      card(page, 'suggestion-quiet').locator('[data-suggestion-sends]')
    ).toHaveText('Sends nothing');
    // A reply suggestion says how long the other side has waited, not when it arrived.
    await expect(
      card(page, 'suggestion-reply').locator('[data-suggestion-time]')
    ).toHaveText('waiting 2 days');
    await page.screenshot({
      path: testInfo.outputPath(`for-you-${theme}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('Run on a composer suggestion opens the composer with its prompt', async ({
  page,
}) => {
  await page.goto('/');
  await card(page, 'suggestion-composer')
    .getByRole('button', { name: 'Open in chat', exact: true })
    .click();

  await expect(requests(page)).toContainText(
    'composer Draft a one-page brief for the budget review.'
  );
  await expect(requests(page)).toContainText('accept suggestion-composer');
});

test('Run starts the run, shows it running, then its result', async ({
  page,
}) => {
  await page.goto('/');
  const suggestion = card(page, 'suggestion-background');
  await suggestion.getByRole('button', { name: 'Run', exact: true }).click();

  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'running');
  await expect(
    suggestion.getByRole('button', { name: 'Run', exact: true })
  ).toHaveCount(0);
  await expect(
    requests(page).getByText('accept suggestion-background')
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Finish runs' }).click();
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'done');
  await suggestion.getByRole('button', { name: 'Open result' }).click();
  await expect(requests(page)).toContainText(
    'open agent_session session-suggestion-background'
  );
});

test('a failed run says so and runs again', async ({ page }) => {
  await page.goto('/');
  const suggestion = card(page, 'suggestion-failed');
  await expect(suggestion).toContainText('The run didn’t finish');
  await suggestion.getByRole('button', { name: 'Run again' }).click();

  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'running');
});

test('a reply suggestion opens its draft, and one without a draft opens the thread', async ({
  page,
}) => {
  await page.goto('/');
  await card(page, 'suggestion-drafted-reply')
    .getByRole('button', { name: 'Open draft' })
    .click();
  await expect(requests(page)).toContainText('draft draft-1');

  await card(page, 'suggestion-reply')
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(requests(page)).toContainText('open email_thread thread-1');
});

test('a routine suggestion shows its sentence and can be reviewed or turned on', async ({
  page,
}) => {
  await page.goto('/');
  const suggestion = card(page, 'suggestion-routine');
  await expect(suggestion).toContainText(
    'Every Friday at 9:00 AM, list the deliveries vendors confirmed this week and post it to #ops.'
  );
  // Review is one of the row's other actions, shown once it is opened.
  await suggestion.getByRole('button', { expanded: false }).click();
  await suggestion.getByRole('button', { name: 'Review' }).click();
  await expect(requests(page)).toContainText('review routine-draft-1');

  await suggestion.getByRole('button', { name: 'Turn on' }).click();
  await expect(requests(page)).toContainText('turn-on routine-draft-1');
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'done');
});

test('a dismissal is sent at once, and Undo asks the server to bring it back', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Dismiss “Prepare the budget review”' })
    .click();
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'dismiss suggestion-composer',
  ]);
  await expect(page.locator('[data-suggestion]')).toHaveCount(8);

  await page
    .locator('[data-suggestion-dismissed="suggestion-composer"]')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(card(page, 'suggestion-composer')).toBeVisible();
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'dismiss suggestion-composer',
    'restore suggestion-composer',
  ]);
  await expect(page.locator('[data-suggestion-dismissed]')).toHaveCount(0);
});

test('a refused dismissal leaves the card and says it didn’t work', async ({
  page,
}) => {
  await page.goto('/?scenario=dismiss-refused');
  const composer = card(page, 'suggestion-composer');
  await composer
    .getByRole('button', { name: 'Dismiss “Prepare the budget review”' })
    .click();

  await expect(composer.getByRole('alert')).toHaveText(
    'That didn’t work. Try again.'
  );
  await expect(page.locator('[data-suggestion-dismissed]')).toHaveCount(0);
});

test('an Undo the server refuses keeps the row and says it may be too late', async ({
  page,
}) => {
  await page.goto('/?scenario=restore-refused');
  await page
    .getByRole('button', { name: 'Dismiss “Prepare the budget review”' })
    .click();
  const row = page.locator('[data-suggestion-dismissed="suggestion-composer"]');
  await row.getByRole('button', { name: 'Undo' }).click();

  await expect(row.getByRole('alert')).toHaveText(
    'Couldn’t undo. It may be too late to bring this back.'
  );
});

test('leaving the page records that the feed was viewed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-suggestion]')).toHaveCount(9);
  await expect(requests(page).getByText('viewed')).toHaveCount(0);

  await page.getByRole('button', { name: 'Leave page' }).click();
  await expect(requests(page).getByText('viewed')).toHaveCount(1);
});

test('sections list suggestions by where they stand, with the server’s counts', async ({
  page,
}) => {
  await page.goto('/');
  const section = (name: string) => page.getByRole('region', { name });

  await expect(section('To do 6').locator('[data-suggestion]')).toHaveCount(6);
  // A failed run sits with the running ones.
  await expect(section('Running 2').locator('[data-suggestion]')).toHaveCount(
    2
  );
  await expect(
    section('Done today 1').locator('[data-suggestion]')
  ).toHaveCount(1);
  await expect(page.locator('[data-suggestions-progress]')).toHaveText(
    '1 of 9 done'
  );
});

test('opening a drafted reply’s row shows the thread and the draft in place', async ({
  page,
}) => {
  await page.goto('/');
  const reply = card(page, 'suggestion-drafted-reply');
  await expect(reply.locator('[data-suggestion-draft]')).toHaveCount(0);

  await reply.getByRole('button', { expanded: false }).click();
  await expect(reply.locator('[data-suggestion-draft]')).toHaveText(
    'The terms are unchanged; only the price moved.'
  );
  await reply.locator('[data-suggestion-source]').click();
  await expect(requests(page)).toContainText('open email_thread thread-1');

  await reply.getByRole('button', { expanded: true }).click();
  await expect(reply.locator('[data-suggestion-draft]')).toHaveCount(0);
});

test('the circle marks a suggestion done without opening anything', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark “Reply about the invoice” done' })
    .click();

  await expect(card(page, 'suggestion-reply')).toHaveAttribute(
    'data-suggestion-status',
    'done'
  );
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'accept suggestion-reply',
  ]);
});

test('earlier finished suggestions fold into the Logbook', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark “Reply about the invoice” done' })
    .click();
  const logbook = page.locator('[data-suggestions-logbook]');
  await expect(logbook).toContainText('1 earlier today');
  await expect(card(page, 'suggestion-done')).toHaveCount(0);

  await logbook.click();
  await expect(card(page, 'suggestion-done')).toBeVisible();
});

test('with nothing waiting or running, the page says so above what was done', async ({
  page,
}) => {
  await page.goto('/?scenario=done');

  await expect(page.locator('[data-suggestions-clear]')).toContainText(
    'You’re all caught up'
  );
  await expect(page.locator('[data-suggestion]')).toHaveCount(1);
});

test('the suggestion opened from Home is scrolled to, in its place', async ({
  page,
}) => {
  await page.goto('/?suggestion=suggestion-done');

  await expect(card(page, 'suggestion-done')).toBeInViewport();
  await expect(page.locator('[data-suggestion]').first()).toHaveAttribute(
    'data-suggestion',
    'suggestion-drafted-reply'
  );
});

test('a running suggestion reads as under way, not as one waiting', async ({
  page,
}) => {
  await page.goto('/');
  const running = card(page, 'suggestion-running');

  await expect(running.locator('[data-suggestion-time]')).toContainText(
    'started'
  );
  await expect(
    running.getByRole('button', { name: 'View progress' })
  ).toBeVisible();
});

test('Run on an suggestion that changed shows the new text and starts nothing until pressed again', async ({
  page,
}) => {
  await page.goto('/?scenario=changed');
  const suggestion = card(page, 'suggestion-background');
  await suggestion.getByRole('button', { name: 'Run', exact: true }).click();

  await expect(suggestion.locator('[data-suggestion-changed]')).toBeVisible();
  await expect(suggestion).toContainText(
    'Rewritten: the team moved the summary'
  );
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'open');

  await suggestion.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'running');
  await expect(suggestion.locator('[data-suggestion-changed]')).toHaveCount(0);
});

test('an opened suggestion becomes done and can be opened again', async ({
  page,
}) => {
  await page.goto('/');
  const reply = card(page, 'suggestion-reply');
  await reply.getByRole('button', { name: 'Open', exact: true }).click();

  await expect(reply).toHaveAttribute('data-suggestion-status', 'done');
  await reply.getByRole('button', { name: 'Open thread' }).click();
  await expect(requests(page).getByText('accept suggestion-reply')).toHaveCount(
    1
  );
  await expect(
    requests(page).getByText('open email_thread thread-1')
  ).toHaveCount(2);
});

test('loading, failure with retry, and empty', async ({ page }) => {
  await page.goto('/?scenario=loading');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('[data-suggestion]')).toHaveCount(0);

  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toContainText(
    'Your suggestions couldn’t be loaded.'
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-suggestion]')).toHaveCount(9);

  await page.goto('/?scenario=empty');
  await expect(page.getByText('You’re all caught up')).toBeVisible();
});

test('dismissing a running suggestion says its run is stopped', async ({
  page,
}) => {
  await page.goto('/');
  const running = card(page, 'suggestion-running');
  await running.hover();
  await running
    .getByRole('button', {
      name: 'Stop the run and dismiss “Post the weekly status summary”',
    })
    .click();

  await expect(
    page.locator('[data-suggestion-dismissed="suggestion-running"]')
  ).toContainText('and stopped its run');
});

test('a card keeps its place and focus when the feed updates under it', async ({
  page,
}) => {
  await page.goto('/');
  const action = card(page, 'suggestion-composer').getByRole('button', {
    name: 'Open in chat',
    exact: true,
  });
  await action.focus();

  // The server's next answer finishes the running suggestion; nothing here
  // touches the focused card.
  await page.evaluate(() => {
    const finish = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Finish runs'
    );
    finish?.click();
  });
  await expect(card(page, 'suggestion-running')).toHaveAttribute(
    'data-suggestion-status',
    'done'
  );

  await expect(action).toBeFocused();
});
