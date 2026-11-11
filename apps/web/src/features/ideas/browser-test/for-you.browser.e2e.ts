import { expect, type Page, test } from '@playwright/test';

const card = (page: Page, id: string) => page.locator(`[data-idea="${id}"]`);
const requests = (page: Page) => page.getByRole('list', { name: 'Requests' });

for (const theme of ['dark', 'light']) {
  test(`every kind and state of idea shows as a card in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);

    await expect(page.locator('[data-idea]')).toHaveCount(9);
    await expect(card(page, 'idea-failed')).toHaveAttribute(
      'data-idea-status',
      'failed'
    );
    await expect(card(page, 'idea-running')).toContainText('Running');
    // A finished idea is one quiet row under Done today.
    await expect(card(page, 'idea-done')).toContainText('Open result');
    // What a run will post is on the card before Run.
    await expect(
      card(page, 'idea-background').locator('[data-idea-sends]')
    ).toHaveText('Posts the weekly status summary in #ops');
    await expect(
      card(page, 'idea-quiet').locator('[data-idea-sends]')
    ).toHaveText('Runs in the background. It posts and sends nothing.');
    // A reply idea says how long the other side has waited, not when it arrived.
    await expect(
      card(page, 'idea-reply').locator('[data-idea-time]')
    ).toHaveText('waiting 2 days');
    await page.screenshot({
      path: testInfo.outputPath(`for-you-${theme}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test('Run on a composer idea opens the composer with its prompt', async ({
  page,
}) => {
  await page.goto('/');
  await card(page, 'idea-composer')
    .getByRole('button', { name: 'Open in chat', exact: true })
    .click();

  await expect(requests(page)).toContainText(
    'composer Draft a one-page brief for the budget review.'
  );
  await expect(requests(page)).toContainText('accept idea-composer');
});

test('Run in background starts the run, shows it running, then its result', async ({
  page,
}) => {
  await page.goto('/');
  const idea = card(page, 'idea-background');
  await idea.getByRole('button', { name: 'Run in background' }).click();

  await expect(idea).toHaveAttribute('data-idea-status', 'running');
  await expect(
    idea.getByRole('button', { name: 'Run in background' })
  ).toHaveCount(0);
  await expect(requests(page).getByText('accept idea-background')).toHaveCount(
    1
  );

  await page.getByRole('button', { name: 'Finish runs' }).click();
  await expect(idea).toHaveAttribute('data-idea-status', 'done');
  await idea.getByRole('button', { name: 'Open result' }).click();
  await expect(requests(page)).toContainText(
    'open agent_session session-idea-background'
  );
});

test('a failed run says so and runs again', async ({ page }) => {
  await page.goto('/');
  const idea = card(page, 'idea-failed');
  await expect(idea).toContainText('The run didn’t finish');
  await idea.getByRole('button', { name: 'Run again' }).click();

  await expect(idea).toHaveAttribute('data-idea-status', 'running');
});

test('a reply idea opens its draft, and one without a draft opens the thread', async ({
  page,
}) => {
  await page.goto('/');
  await card(page, 'idea-drafted-reply')
    .getByRole('button', { name: 'Open draft' })
    .click();
  await expect(requests(page)).toContainText('draft draft-1');

  await card(page, 'idea-reply')
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await expect(requests(page)).toContainText('open email_thread thread-1');
});

test('a routine idea shows its sentence and can be reviewed or turned on', async ({
  page,
}) => {
  await page.goto('/');
  const idea = card(page, 'idea-routine');
  await expect(idea).toContainText(
    'Every Friday at 9:00 AM, list the deliveries vendors confirmed this week and post it to #ops.'
  );
  await idea.getByRole('button', { name: 'Review' }).click();
  await expect(requests(page)).toContainText('review suggestion-1');

  await idea.getByRole('button', { name: 'Turn on' }).click();
  await expect(requests(page)).toContainText('turn-on suggestion-1');
  await expect(idea).toHaveAttribute('data-idea-status', 'done');
});

test('a dismissed idea can be undone, and is sent only on leaving', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Dismiss “Prepare the budget review”' })
    .click();
  await page
    .getByRole('button', { name: 'Dismiss “Reply about the invoice”' })
    .click();
  await expect(page.locator('[data-idea]')).toHaveCount(7);
  await expect(requests(page).getByRole('listitem')).toHaveCount(0);

  await page
    .locator('[data-idea-dismissed="idea-composer"]')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(card(page, 'idea-composer')).toBeVisible();

  await page.getByRole('button', { name: 'Leave page' }).click();
  await expect(requests(page).getByRole('listitem')).toHaveText([
    'dismiss idea-reply',
  ]);
  await expect(card(page, 'idea-reply')).toHaveCount(0);
});

test('tabs filter by where an idea stands', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('radiogroup', {
    name: 'Filter your suggestions',
  });

  await tabs.getByText('Running', { exact: true }).click();
  await expect(page.locator('[data-idea]')).toHaveCount(2);
  await tabs.getByText('Done', { exact: true }).click();
  await expect(page.locator('[data-idea]')).toHaveCount(1);
  await tabs.getByText('Suggestions', { exact: true }).click();
  await expect(page.locator('[data-idea]')).toHaveCount(6);
});

test('the idea opened from Home is scrolled to, in its place', async ({
  page,
}) => {
  await page.goto('/?idea=idea-done');

  await expect(card(page, 'idea-done')).toBeInViewport();
  await expect(page.locator('[data-idea]').first()).toHaveAttribute(
    'data-idea',
    'idea-drafted-reply'
  );
});

test('a running idea reads as under way, not as one waiting', async ({
  page,
}) => {
  await page.goto('/');
  const running = card(page, 'idea-running');

  await expect(running.locator('[data-idea-time]')).toContainText('started');
  await expect(
    running.getByRole('button', { name: 'View progress' })
  ).toBeVisible();
  await expect(running.getByLabel('Prompt')).toHaveCount(0);
});

test('Run on an idea that changed shows the new text and starts nothing until pressed again', async ({
  page,
}) => {
  await page.goto('/?scenario=changed');
  const idea = card(page, 'idea-background');
  await idea.getByRole('button', { name: 'Run in background' }).click();

  await expect(idea.locator('[data-idea-changed]')).toBeVisible();
  await expect(idea).toContainText('Rewritten: the team moved the summary');
  await expect(idea).toHaveAttribute('data-idea-status', 'open');

  await idea.getByRole('button', { name: 'Run in background' }).click();
  await expect(idea).toHaveAttribute('data-idea-status', 'running');
  await expect(idea.locator('[data-idea-changed]')).toHaveCount(0);
});

test('an opened idea becomes done and can be opened again', async ({
  page,
}) => {
  await page.goto('/');
  const reply = card(page, 'idea-reply');
  await reply.getByRole('button', { name: 'Open', exact: true }).click();

  await expect(reply).toHaveAttribute('data-idea-status', 'done');
  await reply.getByRole('button', { name: 'Open thread' }).click();
  await expect(requests(page).getByText('accept idea-reply')).toHaveCount(1);
  await expect(
    requests(page).getByText('open email_thread thread-1')
  ).toHaveCount(2);
});

test('loading, failure with retry, and empty', async ({ page }) => {
  await page.goto('/?scenario=loading');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('[data-idea]')).toHaveCount(0);

  await page.goto('/?scenario=error');
  await expect(page.getByRole('alert')).toContainText(
    'Your suggestions couldn’t be loaded.'
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-idea]')).toHaveCount(9);

  await page.goto('/?scenario=empty');
  await expect(page.getByText('You’re all caught up')).toBeVisible();
});
