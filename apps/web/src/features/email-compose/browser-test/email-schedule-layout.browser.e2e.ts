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

  const summary = toolbar.getByTestId('schedule-summary');
  if ((await summary.count()) === 0) return;
  const summaryBox = await summary.boundingBox();
  const labelBox = await summary
    .getByTestId('schedule-summary-label')
    .boundingBox();
  const cancelBox = await summary.getByRole('button').boundingBox();
  expect(summaryBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(cancelBox!.x + cancelBox!.width).toBeLessThanOrEqual(
    summaryBox!.x + summaryBox!.width + 0.5
  );
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(cancelBox!.x + 0.5);
}

test('selected time appears to the left while clock and send stay icon-sized', async ({
  page,
}) => {
  await page.goto('/?width=420');
  await chooseTomorrowAtNine(page);

  const toolbar = page.getByTestId('toolbar');
  await expect(toolbar).toContainText('Send later:');
  await expect(
    toolbar.getByRole('button', { name: 'Cancel send time' })
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

  await toolbar.getByRole('button', { name: 'Cancel send time' }).click();
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

  await page.evaluate(() => {
    document.body.style.zoom = '200%';
  });
  await expectNoOverlap(toolbar);
});

test('pointer schedule shows Undo and exposes the message in Scheduled', async ({
  page,
}) => {
  await page.goto('/?width=520');
  await chooseTomorrowAtNine(page);
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();

  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Email scheduled for');
  await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByTestId('toolbar')).toContainText('Scheduled for');
  await expect(page.getByTestId('commit-count')).toHaveText('1');

  await page.getByRole('button', { name: /Scheduled \(1\)/ }).click();
  await expect(page.getByRole('heading', { name: 'Scheduled' })).toBeVisible();
  await expect(page.getByText('Quarterly notes')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('toolbar')).not.toContainText('Send later:');
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
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByTestId('toolbar')).not.toContainText('Send later:');
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
  await expect(page.getByTestId('toast')).toContainText('Email scheduled for');
  await expect(page.getByTestId('schedule-summary')).toContainText(
    'Scheduled for'
  );
  await expect(
    page.getByRole('button', {
      name: /Scheduled for .* cancel the schedule/,
    })
  ).toBeVisible();
  await expectNoOverlap(page.getByTestId('toolbar'));
});
