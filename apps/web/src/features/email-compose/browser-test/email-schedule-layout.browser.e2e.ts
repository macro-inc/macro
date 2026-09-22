import { expect, type Locator, test } from '@playwright/test';

async function expectNoOverlap(toolbar: Locator) {
  const toolbarBox = await toolbar.boundingBox();
  const controls = await toolbar.getByRole('button').all();
  const boxes = (
    await Promise.all(controls.map((control) => control.boundingBox()))
  ).filter((box) => box !== null);
  expect(toolbarBox).not.toBeNull();
  expect(boxes).toHaveLength(5);
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    expect(box.x).toBeGreaterThanOrEqual(toolbarBox!.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(
      toolbarBox!.x + toolbarBox!.width + 0.5
    );
    if (index > 0) {
      const previous = boxes[index - 1];
      expect(box.x).toBeGreaterThanOrEqual(previous.x + previous.width - 0.5);
    }
  }
}

test('scheduled label truncates without covering adjacent narrow desktop controls', async ({
  page,
}) => {
  await page.goto('/?width=260');
  const toolbar = page.getByTestId('toolbar');
  await expectNoOverlap(toolbar);

  const schedule = page.getByRole('button', {
    name: /Scheduled for .* Open to propose a new time or cancel/,
  });
  const label = schedule.locator('.truncate');
  await expect(schedule).toHaveCSS('aspect-ratio', 'auto');
  expect(
    await schedule.evaluate((element) => element.clientWidth)
  ).toBeGreaterThan(33);
  expect(
    await label.evaluate((element) => element.scrollWidth > element.clientWidth)
  ).toBe(true);
  await schedule.click();
  await expect(
    page.getByRole('button', { name: 'Cancel schedule' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send email' })).toBeDisabled();
});

test('scheduled controls retain separate mobile hit targets', async ({
  page,
}) => {
  await page.goto('/?mobile&width=240');
  const toolbar = page.getByTestId('toolbar');
  await expectNoOverlap(toolbar);
  const schedule = page.getByRole('button', {
    name: /Scheduled for .* Open to propose a new time or cancel/,
  });
  const box = await schedule.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(36);
  expect(box?.height).toBeGreaterThanOrEqual(36);
});

test('scheduled controls do not overlap at 200 percent browser zoom', async ({
  page,
}) => {
  await page.goto('/?width=260');
  await page.evaluate(() => {
    document.body.style.zoom = '200%';
  });
  await expectNoOverlap(page.getByTestId('toolbar'));
});

test('selection stays a preview until the primary action confirms it', async ({
  page,
}) => {
  await page.goto('/?flow&width=420');
  await page.getByRole('button', { name: 'Choose send time' }).click();
  await page.getByRole('combobox').fill('tomorrow 9am');
  await page.getByRole('option').first().click();

  await expect(page.getByTestId('schedule-status')).toHaveCount(0);
  await expect(page.getByTestId('commit-count')).toHaveText('0');
  await page
    .getByRole('button', {
      name: /Will send .* after you choose Schedule send/,
    })
    .click();
  await expect(page.getByText('Will send:', { exact: true })).toHaveCount(0);
  const clearTime = page.getByRole('button', { name: 'Clear time' });
  await expect(clearTime).toBeVisible();
  expect((await clearTime.boundingBox())?.height).toBeGreaterThanOrEqual(36);
  const sawStaleAccent = await clearTime.evaluate(async (button) => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected Clear time to be a button');
    }
    let sawStaleAccent = false;
    const observe = () => {
      const clearedTrigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Choose send time"]'
      );
      if (clearedTrigger?.querySelector('svg.text-accent')) {
        sawStaleAccent = true;
      }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    button.click();
    observe();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    observer.disconnect();
    return sawStaleAccent;
  });
  expect(sawStaleAccent).toBe(false);
  await expect(
    page.getByRole('button', { name: 'Choose send time' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Choose send time' }).click();
  await page.getByRole('combobox').fill('tomorrow 9am');
  await page.getByRole('option').first().click();
  const submit = page.getByRole('button', {
    name: 'Schedule send',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByTestId('schedule-status')).toContainText(
    'Scheduled for'
  );
  await expect(page.getByTestId('commit-count')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Send email' })).toBeDisabled();
});
