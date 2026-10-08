import { expect, type Locator, type Page, test } from '@playwright/test';

async function chooseTomorrowAtNine(page: Page) {
  await page.getByRole('button', { name: 'Choose send time' }).click();
  await page.getByRole('combobox').fill('tomorrow 9am');
  await page.getByRole('option').first().click();
}

async function expectNoOverlap(toolbar: Locator) {
  const toolbarBox = await toolbar.boundingBox();
  const controls = await toolbar.getByRole('button').all();
  const boxes = (
    await Promise.all(controls.map((control) => control.boundingBox()))
  ).filter((box) => box !== null);
  expect(toolbarBox).not.toBeNull();
  expect(boxes.length).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    expect(box.x).toBeGreaterThanOrEqual(toolbarBox!.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(
      toolbarBox!.x + toolbarBox!.width + 0.5
    );
    expect(box.y).toBeGreaterThanOrEqual(toolbarBox!.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(
      toolbarBox!.y + toolbarBox!.height + 0.5
    );
    for (const other of boxes.slice(index + 1)) {
      const horizontalOverlap =
        Math.min(box.x + box.width, other.x + other.width) -
        Math.max(box.x, other.x);
      const verticalOverlap =
        Math.min(box.y + box.height, other.y + other.height) -
        Math.max(box.y, other.y);
      expect(
        horizontalOverlap > 0.5 && verticalOverlap > 0.5,
        'toolbar buttons must not overlap'
      ).toBe(false);
    }
  }
}

/**
 * Desktop shows the time in a bar under the composer with Cancel at its far
 * edge; touch keeps it inline in the toolbar with Cancel beside the time.
 */
async function expectScheduleSummary(page: Page, placement: 'bar' | 'inline') {
  const toolbarBox = await page.getByTestId('toolbar').boundingBox();
  const summary = page.getByTestId('schedule-summary');
  const summaryBox = await summary.boundingBox();
  const labelBox = await summary
    .getByTestId('schedule-summary-label')
    .boundingBox();
  const cancelBox = await summary.getByRole('button').boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(cancelBox!.x + cancelBox!.width).toBeLessThanOrEqual(
    summaryBox!.x + summaryBox!.width + 0.5
  );
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(cancelBox!.x + 0.5);
  if (placement === 'inline') {
    expect(
      cancelBox!.x - (labelBox!.x + labelBox!.width),
      'Cancel must sit beside the time it cancels'
    ).toBeLessThanOrEqual(8);
    return;
  }
  // The bar's padding scales with browser zoom.
  expect(
    summaryBox!.x + summaryBox!.width - (cancelBox!.x + cancelBox!.width),
    'Cancel sits at the far edge of the bar'
  ).toBeLessThanOrEqual(Math.max(24, summaryBox!.width * 0.1));
  // The bar tucks under the card's rounded corners, so measure its content.
  expect(
    cancelBox!.y + 0.5,
    'The bar sits below the toolbar'
  ).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
}

test('selected time appears to the left while clock and send stay icon-sized', async ({
  page,
}) => {
  await page.goto('/?width=420');
  await chooseTomorrowAtNine(page);

  const toolbar = page.getByTestId('toolbar');
  const summary = page.getByTestId('schedule-summary');
  await expect(summary).toContainText('Scheduled send:');
  await expect(
    summary.getByRole('button', { name: 'Clear send time' })
  ).toBeVisible();

  const clock = toolbar.getByRole('button', { name: /Send time set to/ });
  const submit = toolbar.getByRole('button', {
    name: 'Schedule send',
    exact: true,
  });
  expect((await clock.boundingBox())?.width).toBeLessThanOrEqual(40);
  expect((await submit.boundingBox())?.width).toBeLessThanOrEqual(40);
  await expect(submit).toBeEnabled();
  await expect(clock.locator('svg')).toHaveClass(/text-accent/);
  await expectNoOverlap(toolbar);
  await expectScheduleSummary(page, 'bar');

  await summary.getByRole('button', { name: 'Clear send time' }).click();
  await expect(summary).toHaveCount(0);
  const clearedClock = toolbar.getByRole('button', {
    name: 'Choose send time',
  });
  await expect(clearedClock.locator('svg')).not.toHaveClass(/text-accent/);
});

test('narrow and zoomed toolbars wrap deliberately without overlap', async ({
  page,
}) => {
  await page.goto('/?width=260');
  await chooseTomorrowAtNine(page);
  const toolbar = page.getByTestId('toolbar');
  await expectNoOverlap(toolbar);
  await expectScheduleSummary(page, 'bar');

  await page.evaluate(() => {
    document.body.style.zoom = '200%';
  });
  await expectNoOverlap(toolbar);
  await expectScheduleSummary(page, 'bar');
});

test('pointer schedule shows Undo and exposes the message in Scheduled', async ({
  page,
}) => {
  await page.goto('/?width=520');
  await chooseTomorrowAtNine(page);
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();

  const toast = page.getByRole('status').filter({ hasText: 'Email scheduled' });
  await expect(toast).toContainText('Email scheduled');
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(
    toast.getByRole('button', { name: 'View message' })
  ).toBeVisible();
  await expect(toast).toContainText('Sends ');
  await expect(page.getByTestId('schedule-summary')).toContainText(
    'Scheduled for'
  );
  await expect(page.getByTestId('commit-count')).toHaveText('1');

  await page.getByRole('button', { name: /Scheduled \(1\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Scheduled' })).toBeVisible();
  await expect(page.getByText('Quarterly notes')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('schedule-summary')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Scheduled \(0\)/ })
  ).toBeVisible();
});

test('Undo cancels only the confirmed schedule and restores an editable draft', async ({
  page,
}) => {
  await page.goto('/?width=520');
  await chooseTomorrowAtNine(page);
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Email scheduled' })
    .getByRole('button', { name: 'Undo' })
    .click();

  await expect(page.getByTestId('schedule-summary')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Scheduled \(0\)/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Choose send time' })
  ).toBeVisible();
});

test('keyboard submission commits a selected time exactly once', async ({
  page,
}) => {
  await page.goto('/?mobile&width=360');
  await chooseTomorrowAtNine(page);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+Enter');

  await expect(page.getByTestId('commit-count')).toHaveText('1');
  await expect(
    page.getByRole('status').filter({ hasText: 'Email scheduled' })
  ).toContainText('Email scheduled');
  await expect(page.getByTestId('schedule-summary')).toContainText(
    'Scheduled for'
  );
  await expect(
    page.getByRole('button', {
      name: /Scheduled for .* cancel the schedule/,
    })
  ).toBeVisible();
  await expectNoOverlap(page.getByTestId('toolbar'));
  await expectScheduleSummary(page, 'inline');
});
