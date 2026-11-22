import { expect, type Page, test } from '@playwright/test';

const row = (page: Page, id: string) =>
  page.locator(`[data-suggestion="${id}"]`);
const rows = (page: Page) => page.locator('[data-suggestion]');
const title = (page: Page) => page.locator('section header h1');
const requests = (page: Page) => page.getByRole('list', { name: 'Requests' });
const sidebarList = (page: Page, name: string) =>
  page.locator(`[data-for-you-list="${name}"]`);
const button = (scope: ReturnType<Page['locator']>, name: string) =>
  scope.getByRole('button', { name, exact: true });
const finishRuns = (page: Page) =>
  page.getByRole('button', { name: 'Finish runs' }).click();

/** Every row on the page is the same height, whatever its state. */
async function expectEqualHeights(page: Page) {
  const heights = await rows(page).evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height)
  );
  expect(new Set(heights).size).toBe(1);
  expect(heights[0]).toBe(56);
}

for (const theme of ['dark', 'light']) {
  test(`Today lists every kind and state of suggestion as one row each in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);

    await expect(title(page)).toHaveText('Today');
    await expect(rows(page)).toHaveCount(9);
    await expect(row(page, 'suggestion-failed')).toHaveAttribute(
      'data-suggestion-state',
      'failed'
    );
    await expect(row(page, 'suggestion-running')).toHaveAttribute(
      'data-suggestion-state',
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
    await expectEqualHeights(page);
    await page.screenshot({
      path: testInfo.outputPath(`for-you-${theme}.png`),
    });
    expect(errors).toEqual([]);
  });
}

test('the sidebar lists Today, To do, Suggestions and Done with their counts, and switches between them', async ({
  page,
}) => {
  await page.goto('/');
  await expect(sidebarList(page, 'today')).toContainText('Today9');
  await expect(sidebarList(page, 'toDo')).toContainText('To do3');
  await expect(sidebarList(page, 'suggestions')).toContainText('Suggestions6');
  await expect(sidebarList(page, 'done')).toContainText('Done1');
  await expect(sidebarList(page, 'today')).toHaveAttribute(
    'aria-current',
    'page'
  );

  await sidebarList(page, 'toDo').click();
  await expect(title(page)).toHaveText('To do');
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, 'suggestion-reply')).toBeVisible();

  await sidebarList(page, 'suggestions').click();
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'suggestion-routine')).toBeVisible();

  await sidebarList(page, 'done').click();
  await expect(rows(page)).toHaveCount(1);
  const done = row(page, 'suggestion-done');
  await expect(done).toHaveAttribute('data-suggestion-state', 'done');
  await expect(done.locator('[data-suggestion-time]')).toBeVisible();
  // Pressing a done row's text opens what it left.
  await done.getByRole('button').first().click();
  await expect(requests(page)).toContainText('open');
});

test('the Routines section links to ideas and saved routines', async ({
  page,
}) => {
  await page.goto('/');
  const ideas = page.locator('[data-for-you-routines="ideas"]');
  await expect(ideas).toContainText('Ideas');
  await expect(ideas).toContainText('3');
  // A routine proposed since the last visit waits in Suggestions.
  await expect(ideas.getByRole('img', { name: 'New idea' })).toBeVisible();
  await expect(
    page.locator('[data-for-you-routines="routines"]')
  ).toContainText('Your routines6');

  await ideas.click();
  await page.locator('[data-for-you-routines="routines"]').click();
  await expect(requests(page).getByText('routines')).toHaveCount(2);
});

test('pointing at a to-do swaps its age for mark done, dismiss and Open, without moving anything', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const review = row(page, 'suggestion-review');
  const before = await review.boundingBox();
  const markDone = button(review, 'Mark “Review the vendor contract” done');
  const dismiss = button(review, 'Dismiss “Review the vendor contract”');
  const actions = review.locator('[data-suggestion-hover]');
  await expect(actions).toHaveCSS('opacity', '0');

  await review.hover();
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(markDone).toBeVisible();
  await expect(dismiss).toBeVisible();
  await expect(review.locator('[data-suggestion-time]')).toHaveCSS(
    'opacity',
    '0'
  );
  await expect(button(review, 'Open')).toBeVisible();
  expect(await review.boundingBox()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('hover.png') });

  // Taking a reply up doesn't finish it, so it has no mark done.
  const reply = row(page, 'suggestion-reply');
  await reply.hover();
  await expect(
    button(reply, 'Mark “Reply about the invoice” done')
  ).toHaveCount(0);
  await expect(
    button(reply, 'Dismiss “Reply about the invoice”')
  ).toBeVisible();
});

test('marking a to-do done keeps it in place, struck through, with Undo there and in a toast', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const review = row(page, 'suggestion-review');
  await review.hover();
  await button(review, 'Mark “Review the vendor contract” done').click();

  await expect(review).toHaveAttribute('data-suggestion-state', 'markedDone');
  await expect(review).toContainText(
    'Done just now · Stays here until you leave this page'
  );
  await expect(review.locator('#suggestion-title-suggestion-review')).toHaveCSS(
    'text-decoration-line',
    'line-through'
  );
  await expect(requests(page)).toContainText('accept suggestion-review');
  await expect(sidebarList(page, 'today')).toContainText('Today8');
  await expect(sidebarList(page, 'toDo')).toContainText('To do2');
  const toast = page.getByText('Marked done', { exact: true });
  await expect(toast).toBeVisible();
  await expectEqualHeights(page);
  await page.screenshot({ path: testInfo.outputPath('marked-done.png') });

  await button(review, 'Undo').click();
  await expect(review).toHaveAttribute('data-suggestion-state', 'open');
  await expect(requests(page)).toContainText('restore suggestion-review');
  await expect(sidebarList(page, 'today')).toContainText('Today9');
});

test('the toast’s Undo opens a marked-done to-do again', async ({ page }) => {
  await page.goto('/');
  const review = row(page, 'suggestion-review');
  await review.hover();
  await button(review, 'Mark “Review the vendor contract” done').click();
  await expect(review).toHaveAttribute('data-suggestion-state', 'markedDone');

  await page
    .locator('[data-sonner-toast], [role="status"], li')
    .filter({ hasText: 'Marked done' })
    .getByRole('button', { name: 'Undo' })
    .first()
    .click();
  await expect(review).toHaveAttribute('data-suggestion-state', 'open');
});

test('a run can be stopped: it says it is stopping, then is open again', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const run = row(page, 'suggestion-background');
  await button(run, 'Run').click();

  await expect(run).toHaveAttribute('data-suggestion-state', 'running');
  await expect(run).toContainText(
    'Posts the weekly status summary in #ops · Running…'
  );
  const stop = button(run, 'Stop “Post the weekly status summary”');
  await page.screenshot({ path: testInfo.outputPath('running.png') });
  await stop.click();

  await expect(requests(page)).toContainText('stop suggestion-background');
  await expect(run).toContainText('Stopping…');
  await expect(stop).toBeDisabled();

  await finishRuns(page);
  await expect(run).toHaveAttribute('data-suggestion-state', 'open');
  await expect(button(run, 'Run')).toBeVisible();
});

test('a run that finishes says what it did in one line, and Open opens its session', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const run = row(page, 'suggestion-background');
  await button(run, 'Run').click();
  await expect(run).toHaveAttribute('data-suggestion-state', 'running');

  await finishRuns(page);
  await expect(run).toHaveAttribute('data-suggestion-state', 'finished');
  await expect(run.locator('[data-suggestion-report]')).toHaveText(
    'Posted the summary in #ops with six confirmed deliveries.'
  );
  // It stays in place for the visit, and is no longer counted.
  await expect(sidebarList(page, 'today')).toContainText('Today7');
  await expectEqualHeights(page);
  await page.screenshot({ path: testInfo.outputPath('finished.png') });

  await button(run, 'Open').click();
  await expect(requests(page)).toContainText(
    'open agent_session session-suggestion-background'
  );
});

test('Turn on saves a routine suggestion switched on, in one click, with its switch and Edit', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const routine = row(page, 'suggestion-routine');
  await button(routine, 'Turn on').click();

  await expect(requests(page)).toContainText('turn-on routine-draft-1');
  await expect(routine).toHaveAttribute('data-suggestion-state', 'routineOn');
  await expect(routine).toContainText('Weekly vendor digest is on');
  await expect(routine).toContainText('Runs Fridays at 9:00 AM');
  const toggle = routine.getByRole('switch', {
    name: 'Run “Weekly vendor digest”',
  });
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText('Routine turned on', { exact: true })
  ).toBeVisible();
  await expectEqualHeights(page);
  await page.screenshot({ path: testInfo.outputPath('routine-on.png') });

  await toggle.click({ force: true });
  await expect(requests(page)).toContainText('routine routine-1 off');
  await expect(toggle).not.toBeChecked();
  // Off, the row stops saying it is on and when it runs.
  await expect(routine).toContainText('Weekly vendor digest is off');
  await expect(routine).toContainText('Won’t run until you turn it back on');
  await expect(routine).not.toContainText('Runs Fridays');
  await expectEqualHeights(page);

  await button(routine, 'Edit').click();
  await expect(requests(page)).toContainText('open scheduled_action routine-1');
});

test('a dismissal is sent at once, and the row stays in place with Undo', async ({
  page,
}) => {
  await page.goto('/');
  const composer = row(page, 'suggestion-composer');
  await composer.hover();
  await button(composer, 'Dismiss “Prepare the budget review”').click();

  await expect(composer).toHaveAttribute('data-suggestion-state', 'dismissed');
  await expect(composer).toContainText('Dismissed');
  await expect(requests(page)).toContainText('dismiss suggestion-composer');
  await expect(sidebarList(page, 'today')).toContainText('Today8');
  await expectEqualHeights(page);

  await button(composer, 'Undo').click();
  await expect(composer).toHaveAttribute('data-suggestion-state', 'open');
  await expect(requests(page)).toContainText('restore suggestion-composer');
});

test('dismissing a running suggestion says its run is stopped', async ({
  page,
}) => {
  await page.goto('/');
  const running = row(page, 'suggestion-running');
  await running.hover();
  await button(
    running,
    'Stop the run and dismiss “Post the weekly status summary”'
  ).click();

  await expect(running).toContainText('Dismissed, and its run was stopped');
});

test('a refused dismissal leaves the row and says it didn’t work', async ({
  page,
}) => {
  await page.goto('/?scenario=dismiss-refused');
  const composer = row(page, 'suggestion-composer');
  await composer.hover();
  await button(composer, 'Dismiss “Prepare the budget review”').click();

  await expect(composer).toHaveAttribute('data-suggestion-state', 'open');
  await expect(composer.getByRole('alert')).toHaveText(
    'That didn’t work. Try again.'
  );
  await expectEqualHeights(page);
});

test('an Undo the server refuses keeps the row and says it may be too late', async ({
  page,
}) => {
  await page.goto('/?scenario=restore-refused');
  const composer = row(page, 'suggestion-composer');
  await composer.hover();
  await button(composer, 'Dismiss “Prepare the budget review”').click();
  await button(composer, 'Undo').click();

  await expect(composer).toHaveAttribute('data-suggestion-state', 'dismissed');
  await expect(composer.getByRole('alert')).toContainText('It may be too late');
});

test('Open chat opens the composer, and pressing a run’s text looks without starting it', async ({
  page,
}) => {
  await page.goto('/');
  await button(row(page, 'suggestion-composer'), 'Open chat').click();
  await expect(requests(page)).toContainText('composer');

  const quiet = row(page, 'suggestion-quiet');
  await quiet.locator('#suggestion-title-suggestion-quiet').click();
  await expect(quiet).toHaveAttribute('data-suggestion-state', 'open');
  await expect(requests(page).getByText('accept suggestion-quiet')).toHaveCount(
    0
  );
});

test('a failed run says so and Retry runs it again', async ({ page }) => {
  await page.goto('/');
  const failed = row(page, 'suggestion-failed');
  await expect(failed).toContainText('The run didn’t finish');
  await button(failed, 'Retry').click();
  await expect(requests(page)).toContainText('accept suggestion-failed');
  await expect(failed).toHaveAttribute('data-suggestion-state', 'running');
});

test('a to-do opens its draft, and one without a draft opens its thread', async ({
  page,
}) => {
  await page.goto('/');
  const drafted = row(page, 'suggestion-drafted-reply');
  await drafted.hover();
  await button(drafted, 'Open draft').click();
  await expect(requests(page)).toContainText('draft');

  const reply = row(page, 'suggestion-reply');
  await reply.hover();
  await button(reply, 'Open').click();
  await expect(requests(page)).toContainText('open email_thread thread-1');
  // Opening the thread isn't replying: the row stays open.
  await expect(reply).toHaveAttribute('data-suggestion-state', 'open');

  await page.getByRole('button', { name: 'Send replies' }).click();
  await expect(reply).toHaveAttribute('data-suggestion-state', 'markedDone');
});

for (const theme of ['dark', 'light']) {
  test(`with nothing waiting, Today says you’re all caught up in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?theme=${theme}&scenario=done`);
    const caughtUp = page.locator('[data-suggestions-caught-up]');
    await expect(caughtUp).toContainText('You’re all caught up');
    await expect(caughtUp).toContainText('1 thing done today.');
    await expect(page.locator('[data-suggestions-date]')).toContainText(
      '· Nothing needs you right now'
    );
    await page.screenshot({
      path: testInfo.outputPath(`caught-up-${theme}.png`),
    });

    await button(caughtUp, 'Browse routines').click();
    await expect(requests(page)).toContainText('routines');
    await button(caughtUp, 'See what’s done').click();
    await expect(title(page)).toHaveText('Done');
    await expect(rows(page)).toHaveCount(1);
  });
}

test('finishing the last thing in Today shows all caught up above what was finished', async ({
  page,
}) => {
  await page.goto('/?scenario=empty');
  await expect(page.locator('[data-suggestions-caught-up]')).toContainText(
    'New suggestions show up here'
  );
  await sidebarList(page, 'toDo').click();
  await expect(page.locator('[data-suggestions-empty]')).toHaveText(
    'Nothing is waiting on you.'
  );
});

test('the suggestion opened from Home is scrolled to, in its place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto('/?suggestion=suggestion-failed');

  await expect(row(page, 'suggestion-failed')).toBeInViewport();
  await expect(rows(page).first()).toHaveAttribute(
    'data-suggestion',
    'suggestion-drafted-reply'
  );
});

test('Run on a suggestion that changed shows the new text and starts nothing until pressed again', async ({
  page,
}) => {
  await page.goto('/?scenario=changed');
  const suggestion = row(page, 'suggestion-background');
  await button(suggestion, 'Run').click();

  await expect(suggestion.locator('[data-suggestion-changed]')).toBeVisible();
  // Run is one press away, so where the new version posts is still said.
  await expect(suggestion.locator('[data-suggestion-sends]')).toHaveText(
    'Posts the weekly status summary in #leadership'
  );
  await expect(suggestion).toHaveAttribute('data-suggestion-state', 'open');
  await expectEqualHeights(page);

  await button(suggestion, 'Run').click();
  await expect(suggestion).toHaveAttribute('data-suggestion-state', 'running');
  await expect(suggestion.locator('[data-suggestion-changed]')).toHaveCount(0);
});

test('leaving the page records that the feed was viewed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Leave page' }).click();
  await expect(requests(page)).toContainText('viewed');
});

test('loading, and failure with retry', async ({ page }) => {
  await page.goto('/?scenario=loading');
  await expect(
    page.getByRole('status', { name: 'Loading your suggestions' })
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(0);

  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toContainText(
    'Your suggestions couldn’t be loaded.'
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(9);
});

test('a row keeps its place and focus when the feed updates under it', async ({
  page,
}) => {
  await page.goto('/');
  const action = button(row(page, 'suggestion-composer'), 'Open chat');
  await action.focus();

  // The server's next answer finishes the running suggestion; nothing here
  // touches the focused row.
  await page.evaluate(() => {
    const finish = [...document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === 'Finish runs'
    );
    finish?.click();
  });
  await expect(row(page, 'suggestion-running')).toHaveAttribute(
    'data-suggestion-state',
    'finished'
  );

  await expect(action).toBeFocused();
});

test('a refused Run still says what the run sends beside the failure', async ({
  page,
}) => {
  await page.goto('/?scenario=accept-refused');
  const suggestion = row(page, 'suggestion-background');
  await button(suggestion, 'Run').click();

  await expect(suggestion.getByRole('alert')).toContainText(
    'That didn’t work. Try again.'
  );
  await expect(suggestion.locator('[data-suggestion-sends]')).toHaveText(
    'Posts the weekly status summary in #ops'
  );
});

test('marking done or dismissing from the keyboard leaves focus on Undo', async ({
  page,
}) => {
  await page.goto('/');
  const review = row(page, 'suggestion-review');
  await button(review, 'Mark “Review the vendor contract” done').focus();
  await page.keyboard.press('Enter');
  await expect(review).toHaveAttribute('data-suggestion-state', 'markedDone');
  await expect(button(review, 'Undo')).toBeFocused();

  const composer = row(page, 'suggestion-composer');
  await button(composer, 'Dismiss “Prepare the budget review”').focus();
  await page.keyboard.press('Enter');
  await expect(composer).toHaveAttribute('data-suggestion-state', 'dismissed');
  await expect(button(composer, 'Undo')).toBeFocused();
});

test('a dismissed routine idea offers no Undo, which the server would refuse', async ({
  page,
}) => {
  await page.goto('/');
  const routine = row(page, 'suggestion-routine');
  await routine.hover();
  await button(routine, 'Dismiss “Weekly vendor digest”').click();

  await expect(routine).toHaveAttribute('data-suggestion-state', 'dismissed');
  await expect(routine).toContainText('Dismissed');
  await expect(button(routine, 'Undo')).toHaveCount(0);
  await expectEqualHeights(page);
});

test('each list opens at its top, wherever the last one was scrolled', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/');
  const scroller = page.locator('section[aria-label="Today"]');
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(
    await scroller.evaluate((element) => element.scrollTop)
  ).toBeGreaterThan(0);

  await sidebarList(page, 'suggestions').click();
  await expect(title(page)).toHaveText('Suggestions');
  expect(
    await page
      .locator('section[aria-label="Suggestions"]')
      .evaluate((element) => element.scrollTop)
  ).toBe(0);
});
