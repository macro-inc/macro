import { expect, type Page, test } from '@playwright/test';

const row = (page: Page, id: string) =>
  page.locator(`[data-suggestion="${id}"]`);
const list = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const requests = (page: Page) => page.getByRole('list', { name: 'Requests' });

for (const theme of ['dark', 'light']) {
  test(`every kind and state of suggestion shows as a row in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);

    await expect(page.locator('[data-suggestion]')).toHaveCount(10);
    await expect(row(page, 'suggestion-done')).toHaveAttribute(
      'data-suggestion-status',
      'done'
    );
    await expect(row(page, 'suggestion-failed')).toHaveAttribute(
      'data-suggestion-status',
      'failed'
    );
    await expect(row(page, 'suggestion-running')).toHaveAttribute(
      'data-suggestion-status',
      'running'
    );
    // What a run will post is on its row before Run.
    await expect(
      row(page, 'suggestion-background').locator('[data-suggestion-sends]')
    ).toHaveText('Posts the weekly status summary in #ops');
    // A run that sends nothing doesn't say so.
    await expect(
      row(page, 'suggestion-quiet').locator('[data-suggestion-sends]')
    ).toHaveCount(0);
    // A to-do names the item it is about, and how long its sender has waited.
    const reply = row(page, 'suggestion-reply');
    await expect(reply.locator('[data-suggestion-source]')).toHaveText(
      'email_thread thread-1 · Priya Shah'
    );
    await expect(reply.locator('[data-suggestion-time]')).toHaveText('2 days');
    await expect(reply.locator('[data-suggestion-drafted]')).toHaveCount(0);
    await expect(
      row(page, 'suggestion-drafted-reply').locator('[data-suggestion-drafted]')
    ).toHaveText(' · A reply is drafted');
    await page.screenshot({
      path: testInfo.outputPath(`for-you-${theme}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('the page is four cards: Suggestions, To do, Running, Done today', async ({
  page,
}) => {
  await page.goto('/');

  const names = ['Suggestions', 'To do', 'Running', 'Done today'];
  // Work Macro can do that still waits; the person's own mail and documents;
  // what was started, a failed run included; what finished.
  const counts = [4, 3, 2, 1];
  let bottom = 0;
  for (const [index, name] of names.entries()) {
    const card = list(page, name);
    await expect(card.locator('[data-suggestion]')).toHaveCount(counts[index]);
    const box = await card.boundingBox();
    if (!box) throw new Error(`expected the ${name} card`);
    expect(box.width).toBe(720);
    expect(box.y).toBeGreaterThan(bottom);
    bottom = box.y + box.height;
  }
});

test('a row is two lines: a medium title over a smaller line', async ({
  page,
}) => {
  await page.goto('/');
  const reply = row(page, 'suggestion-reply');

  const box = await reply.boundingBox();
  expect(box?.height).toBe(56);
  // A long line is cut where the row ends, so every row is the same height.
  for (const each of await page.locator('[data-suggestion]').all()) {
    expect((await each.boundingBox())?.height).toBe(56);
  }
  const line = row(page, 'suggestion-background').locator(
    '[data-slot="item-description"]'
  );
  await expect(line).toHaveCSS('text-overflow', 'ellipsis');
  // What a run sends leads its line, so it is never the part cut off.
  await expect(line).toHaveText(
    'Posts the weekly status summary in #ops · The team posts one every Friday; this week has none.'
  );
  const title = reply.locator('[data-slot="item-title"]');
  // A title never takes a second line.
  await expect(title).toHaveCSS('white-space', 'nowrap');
  await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  await expect(title).toHaveCSS('font-size', '14px');
  await expect(title).toHaveCSS('font-weight', '500');
  await expect(reply.locator('[data-slot="item-description"]')).toHaveCSS(
    'font-size',
    '13px'
  );
});

test('Open chat on a composer suggestion opens the composer with its prompt', async ({
  page,
}) => {
  await page.goto('/');
  await row(page, 'suggestion-composer')
    .getByRole('button', { name: 'Open chat', exact: true })
    .click();

  await expect(requests(page)).toContainText(
    'composer Draft a one-page brief for the budget review.'
  );
  await expect(requests(page)).toContainText('accept suggestion-composer');
});

test('Run moves a suggestion to Running, and its finished run to Done today', async ({
  page,
}) => {
  await page.goto('/');
  const suggestion = row(page, 'suggestion-background');
  await suggestion.getByRole('button', { name: 'Run', exact: true }).click();

  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'running');
  await expect(suggestion).toContainText('Running.');
  await expect(
    suggestion.getByRole('button', { name: 'Run', exact: true })
  ).toHaveCount(0);
  await expect(
    requests(page).getByText('accept suggestion-background')
  ).toHaveCount(1);

  await suggestion.getByRole('button', { name: 'View', exact: true }).click();
  await expect(requests(page)).toContainText(
    'open agent_session session-suggestion-background'
  );

  await expect(
    list(page, 'Running').locator('[data-suggestion="suggestion-background"]')
  ).toBeVisible();

  await page.getByRole('button', { name: 'Finish runs' }).click();
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'done');
  await expect(
    list(page, 'Done today').locator(
      '[data-suggestion="suggestion-background"]'
    )
  ).toBeVisible();
  // Pressing a finished row's text opens what it left.
  await suggestion.getByText('Post the weekly status summary').click();
  await expect(
    requests(page).getByText('open agent_session session-suggestion-background')
  ).toHaveCount(2);
});

test('pressing a run’s text puts its prompt in the composer without starting it', async ({
  page,
}) => {
  await page.goto('/');
  const suggestion = row(page, 'suggestion-background');
  await suggestion.getByText('Post the weekly status summary').first().click();

  await expect(requests(page).getByRole('listitem')).toHaveText([
    'composer Summarize this week and post it.',
  ]);
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'open');
});

test('pointing at a run offers Open chat beside Run, and a routine Review', async ({
  page,
}) => {
  await page.goto('/');
  const run = row(page, 'suggestion-background');
  const openChat = run.getByRole('button', { name: 'Open chat', exact: true });
  await expect(openChat.locator('..')).toHaveCSS('opacity', '0');
  await run.hover();
  await expect(openChat.locator('..')).toHaveCSS('opacity', '1');
  await openChat.click();
  // Its prompt is in the composer and nothing was started.
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'composer Summarize this week and post it.',
  ]);
  await expect(run).toHaveAttribute('data-suggestion-status', 'open');

  const routine = row(page, 'suggestion-routine');
  await routine.hover();
  await routine.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(requests(page)).toContainText('review routine-draft-1');
});

test('a row shows its age at rest, and its buttons with dismiss in the age’s place when pointed at', async ({
  page,
}) => {
  await page.goto('/');
  const run = row(page, 'suggestion-background');
  const button = run.getByRole('button', { name: 'Run', exact: true });
  const time = run.locator('[data-suggestion-time]');
  // Run is hidden until the row is pointed at; only the age shows.
  await expect(button.locator('..')).toHaveCSS('opacity', '0');
  await expect(time).toHaveCSS('opacity', '1');
  const before = await button.boundingBox();
  const age = await time.boundingBox();
  const height = (await run.boundingBox())?.height;

  await run.hover();
  await expect(button.locator('..')).toHaveCSS('opacity', '1');
  await expect(time).toHaveCSS('opacity', '0');
  const dismiss = await run
    .getByRole('button', { name: 'Dismiss “Post the weekly status summary”' })
    .boundingBox();
  const after = await button.boundingBox();
  if (!before || !after || !dismiss || !age) {
    throw new Error('expected the buttons and the age');
  }
  // Nothing moves, and dismiss ends where the age ended.
  expect(after.x).toBe(before.x);
  expect((await run.boundingBox())?.height).toBe(height);
  expect(dismiss.x).toBeGreaterThan(after.x + after.width);
  expect(Math.round(dismiss.x + dismiss.width)).toBe(
    Math.round(age.x + age.width)
  );
});

test('a failed run says so and Retry runs it again', async ({ page }) => {
  await page.goto('/');
  const suggestion = row(page, 'suggestion-failed');
  // What retrying will send still leads the line.
  await expect(suggestion).toContainText(
    'Posts the weekly status summary in #ops · The run didn’t finish'
  );
  await suggestion.getByRole('button', { name: 'Retry', exact: true }).click();

  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'running');
});

test('a to-do opens its draft, and one without a draft opens its thread', async ({
  page,
}) => {
  await page.goto('/');
  const drafted = row(page, 'suggestion-drafted-reply');
  await drafted.hover();
  await drafted.getByRole('button', { name: 'Open draft' }).click();
  await expect(requests(page)).toContainText('draft draft-1');
  // Opening a reply's draft isn't replying: it stays in To do.
  await expect(drafted).toHaveAttribute('data-suggestion-status', 'open');

  // Pressing a row's text opens it too.
  await row(page, 'suggestion-reply')
    .getByText('Reply about the invoice')
    .click();
  await expect(requests(page)).toContainText('open email_thread thread-1');
});

test('pointing at a to-do swaps its age for Open and dismiss', async ({
  page,
}) => {
  await page.goto('/');
  const reply = row(page, 'suggestion-reply');
  const age = reply.locator('[data-suggestion-time]');
  const open = reply.getByRole('button', { name: 'Open', exact: true });
  await expect(age).toHaveCSS('opacity', '1');
  await expect(open).toHaveCSS('opacity', '1');
  await expect(open.locator('..')).toHaveCSS('opacity', '0');

  await reply.hover();
  await expect(age).toHaveCSS('opacity', '0');
  await expect(open.locator('..')).toHaveCSS('opacity', '1');
  // The row keeps its height when the buttons take the age's place.
  expect((await reply.boundingBox())?.height).toBe(56);
});

test('a routine suggestion shows its sentence and can be reviewed or turned on', async ({
  page,
}) => {
  await page.goto('/');
  const suggestion = row(page, 'suggestion-routine');
  await expect(suggestion).toContainText(
    'Every Friday at 9:00 AM, list the deliveries vendors confirmed this week and post it to #ops.'
  );
  // Pressing its text opens the drafted routine for review.
  await suggestion.getByText('Weekly vendor digest').click();
  await expect(requests(page)).toContainText('review routine-draft-1');

  await suggestion.getByRole('button', { name: 'Turn on' }).click();
  await expect(requests(page)).toContainText('turn-on routine-draft-1');
  await expect(suggestion).toHaveAttribute('data-suggestion-status', 'done');
});

test('a dismissal is sent at once, and the row stays in its card with Undo', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Dismiss “Prepare the budget review”' })
    .click();
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'dismiss suggestion-composer',
  ]);
  await expect(page.locator('[data-suggestion]')).toHaveCount(9);

  const dismissed = list(page, 'Suggestions').locator(
    '[data-suggestion-dismissed="suggestion-composer"]'
  );
  await expect(dismissed).toContainText('Prepare the budget review');
  await expect(dismissed).toContainText('Dismissed');
  await dismissed.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'suggestion-composer')).toBeVisible();
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'dismiss suggestion-composer',
    'restore suggestion-composer',
  ]);
  await expect(page.locator('[data-suggestion-dismissed]')).toHaveCount(0);
});

test('a refused dismissal leaves the row and says it didn’t work', async ({
  page,
}) => {
  await page.goto('/?scenario=dismiss-refused');
  const composer = row(page, 'suggestion-composer');
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
  const dismissed = page.locator(
    '[data-suggestion-dismissed="suggestion-composer"]'
  );
  await dismissed.getByRole('button', { name: 'Undo' }).click();

  await expect(dismissed.getByRole('alert')).toHaveText(
    'Couldn’t undo. It may be too late to bring this back.'
  );
});

test('dismissing a running suggestion says its run is stopped', async ({
  page,
}) => {
  await page.goto('/');
  const running = row(page, 'suggestion-running');
  await running.hover();
  await running
    .getByRole('button', {
      name: 'Stop the run and dismiss “Post the weekly status summary”',
    })
    .click();

  await expect(
    page.locator('[data-suggestion-dismissed="suggestion-running"]')
  ).toContainText('Dismissed, and its run was stopped');
});

test('leaving the page records that the feed was viewed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-suggestion]')).toHaveCount(10);
  await expect(requests(page).getByText('viewed')).toHaveCount(0);

  await page.getByRole('button', { name: 'Leave page' }).click();
  await expect(requests(page).getByText('viewed')).toHaveCount(1);
});

test('the circle marks a to-do done without opening anything', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark “Review the vendor contract” done' })
    .click();

  await expect(row(page, 'suggestion-review')).toHaveAttribute(
    'data-suggestion-status',
    'done'
  );
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'accept suggestion-review',
  ]);
});

test('a reply’s circle is a mark that says the reply finishes it', async ({
  page,
}) => {
  await page.goto('/');
  const reply = row(page, 'suggestion-reply');
  await expect(
    page.getByRole('button', { name: 'Mark “Reply about the invoice” done' })
  ).toHaveCount(0);

  await reply.locator('[data-suggestion-waits]').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Done once you reply');
  await expect(requests(page).getByRole('listitem')).toHaveCount(0);
});

test('earlier finished suggestions fold behind the card’s last row', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Mark “Review the vendor contract” done' })
    .click();
  const done = list(page, 'Done today');
  await expect(done).toContainText('1 earlier today');
  await expect(row(page, 'suggestion-review')).toBeVisible();
  await expect(row(page, 'suggestion-done')).toHaveCount(0);

  await done.getByRole('button', { name: '1 earlier today' }).click();
  await expect(row(page, 'suggestion-done')).toBeVisible();
});

test('with nothing waiting or running, a card says so above what was done', async ({
  page,
}) => {
  await page.goto('/?scenario=done');
  const clear = page.locator('[data-suggestions-clear]');
  await expect(clear).toContainText('You’re clear for today');
  for (const name of ['Suggestions', 'To do', 'Running']) {
    await expect(list(page, name)).toHaveCount(0);
  }
  await expect(
    list(page, 'Done today').locator('[data-suggestion]')
  ).toHaveCount(1);

  await page.goto('/?scenario=empty');
  await expect(clear).toContainText('You’re clear for today');
  await expect(list(page, 'Done today')).toHaveCount(0);
});

test('the suggestion opened from Home is scrolled to, in its place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto('/?suggestion=suggestion-reply');

  await expect(row(page, 'suggestion-reply')).toBeInViewport();
  await expect(page.locator('[data-suggestion]').first()).toHaveAttribute(
    'data-suggestion',
    'suggestion-background'
  );
});

test('a running suggestion reads as under way, with View in place of Run', async ({
  page,
}) => {
  await page.goto('/');
  const running = row(page, 'suggestion-running');

  await expect(running).toContainText(
    'Posts the weekly status summary in #ops · Running.'
  );
  await expect(
    running.getByRole('button', { name: 'View', exact: true })
  ).toBeVisible();
  await expect(
    running.getByRole('button', { name: 'Run', exact: true })
  ).toHaveCount(0);
});

test('Run on a suggestion that changed shows the new text and starts nothing until pressed again', async ({
  page,
}) => {
  await page.goto('/?scenario=changed');
  const suggestion = row(page, 'suggestion-background');
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

test('an opened reply stays in To do until the reply is sent', async ({
  page,
}) => {
  await page.goto('/');
  const reply = row(page, 'suggestion-reply');
  await reply.hover();
  await reply.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(requests(page)).toContainText('open email_thread thread-1');

  // Opening the thread isn't replying: the row stays open and opens again.
  await expect(reply).toHaveAttribute('data-suggestion-status', 'open');
  await expect(list(page, 'To do').locator('[data-suggestion]')).toHaveCount(3);
  await reply.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(
    requests(page).getByText('open email_thread thread-1')
  ).toHaveCount(2);

  // The reply on its thread makes it done, under Done today.
  await page.getByRole('button', { name: 'Send replies' }).click();
  await expect(reply).toHaveAttribute('data-suggestion-status', 'done');
  await expect(
    list(page, 'Done today').locator('[data-suggestion="suggestion-reply"]')
  ).toBeVisible();
  await expect(requests(page).getByText('accept suggestion-reply')).toHaveCount(
    2
  );
});

test('loading, and failure with retry', async ({ page }) => {
  await page.goto('/?scenario=loading');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('[data-suggestion]')).toHaveCount(0);

  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toContainText(
    'Your suggestions couldn’t be loaded.'
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-suggestion]')).toHaveCount(10);
});

test('a row keeps its place and focus when the feed updates under it', async ({
  page,
}) => {
  await page.goto('/');
  const action = row(page, 'suggestion-composer').getByRole('button', {
    name: 'Open chat',
    exact: true,
  });
  await action.focus();

  // The server's next answer finishes the running suggestion; nothing here
  // touches the focused row.
  await page.evaluate(() => {
    const finish = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Finish runs'
    );
    finish?.click();
  });
  await expect(row(page, 'suggestion-running')).toHaveAttribute(
    'data-suggestion-status',
    'done'
  );

  await expect(action).toBeFocused();
});
