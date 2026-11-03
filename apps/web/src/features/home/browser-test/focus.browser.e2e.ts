import { expect, test } from '@playwright/test';

for (const theme of ['dark', 'light']) {
  test(`review, edit, finish and undo a draft in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/?theme=${theme}`);
    await expect(
      page.getByRole('heading', { name: 'Home priority list' })
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
    await page
      .getByRole('button', {
        name: 'Review reply: Give the launch plan a green light',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page
      .getByLabel('Your draft', { exact: true })
      .fill('Looks good — let’s review on Thursday.');
    await page.getByRole('button', { name: 'Close preview' }).click();
    await page
      .getByRole('button', {
        name: 'Review reply: Give the launch plan a green light',
        exact: true,
      })
      .click();
    await expect(page.getByLabel('Your draft', { exact: true })).toHaveValue(
      'Looks good — let’s review on Thursday.'
    );
    await page.screenshot({ path: testInfo.outputPath(`draft-${theme}.png`) });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: 'Review reply: Give the launch plan a green light',
        exact: true,
      })
    ).toHaveCount(0);
    await page.keyboard.press('e');
    await expect(page.locator('[data-focus-row]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Undo last' }).click();
    await page.getByRole('button', { name: 'Undo last' }).click();
    await expect(
      page.getByRole('button', {
        name: 'Review reply: Give the launch plan a green light',
        exact: true,
      })
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('keyboard navigation, editing guard and empty state', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('j');
  await expect(
    page.getByRole('button', {
      name: 'Review message: Unblock the next design pass',
      exact: true,
    })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Review reply: Give the launch plan a green light',
      exact: true,
    })
    .focus();
  await page.keyboard.press('j');
  await expect(
    page.getByRole('button', {
      name: 'Review message: Unblock the next design pass',
      exact: true,
    })
  ).toBeFocused();
  await page.keyboard.press('k');
  await expect(
    page.getByRole('button', {
      name: 'Review reply: Give the launch plan a green light',
      exact: true,
    })
  ).toBeFocused();
  await page
    .getByRole('button', {
      name: 'Review reply: Give the launch plan a green light',
      exact: true,
    })
    .click();
  await page.getByLabel('Your draft', { exact: true }).fill('jke');
  await page.keyboard.press('e');
  await expect(page.locator('[data-focus-row]')).toHaveCount(5);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page
    .getByRole('button', {
      name: 'Review reply: Give the launch plan a green light',
      exact: true,
    })
    .focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('e');
  await expect(page.getByText('A little more breathing room.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last' }).click();
  await expect(page.locator('[data-focus-row]')).toHaveCount(1);
});

test('routine, document and empty draft use local previews', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (
      !request.url().startsWith('http://127.0.0.1:3006') &&
      !request.url().startsWith('data:')
    )
      externalRequests.push(request.url());
  });
  await page.goto('/');
  await page
    .getByRole('button', {
      name: 'Set up routine: Start the week with the full picture',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Routine schedule')).toHaveValue(
    'Every Monday at 9:00 AM'
  );
  await page.getByLabel('Routine schedule').fill('Every Friday at 10:00 AM');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Open proposal: Take a look at the project proposal',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Scope', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page
    .getByRole('button', {
      name: 'Write reply: Close the loop on next steps',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Your draft', { exact: true })).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Done', exact: true })
  ).toBeDisabled();
  await page
    .getByLabel('Your draft', { exact: true })
    .fill('Here are the priorities for this week.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(externalRequests).toEqual([]);
});

test('today calendar centers current time, scrolls, and filters recurring events', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-02T11:15:00'));
  await page.goto('/');
  const calendar = page.getByRole('region', {
    name: "Today's calendar",
    exact: true,
  });
  const scroller = calendar.locator(
    '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
  );
  await expect(calendar.locator('.fc-timegrid-now-indicator-line')).toHaveCount(
    1
  );
  await expect
    .poll(async () =>
      calendar.evaluate((root) => {
        const marker = root.querySelector('.fc-timegrid-now-indicator-line');
        const scroll = root.querySelector(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
        if (!marker || !scroll) return Infinity;
        return Math.abs(
          marker.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top -
            scroll.clientHeight / 2
        );
      })
    )
    .toBeLessThan(4);
  expect(
    await calendar.evaluate((el) =>
      Math.round(el.getBoundingClientRect().height)
    )
  ).toBe(200);
  await calendar.evaluate((el) => {
    const parent = el.parentElement;
    const next = el.nextSibling;
    const scroll = el.querySelector(
      '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
    );
    el.remove();
    if (scroll) scroll.scrollTop = 0;
    requestAnimationFrame(() => parent?.insertBefore(el, next));
  });
  await expect
    .poll(async () =>
      calendar.evaluate((root) => {
        const marker = root.querySelector('.fc-timegrid-now-indicator-line');
        const scroll = root.querySelector(
          '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller'
        );
        if (!marker || !scroll) return Infinity;
        return Math.abs(
          marker.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top -
            scroll.clientHeight / 2
        );
      })
    )
    .toBeLessThan(4);
  await calendar.getByText('Design review', { exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('11:00 – 11:45 AM');
  await page.getByRole('button', { name: 'Close event' }).click();
  await expect(
    calendar.locator('.fc-event').filter({ hasText: 'Team check-in' })
  ).toHaveCount(1);
  await calendar.getByText('Hide recurring', { exact: true }).click();
  await expect(
    calendar.locator('.fc-event').filter({ hasText: 'Team check-in' })
  ).toHaveCount(0);
  await expect(
    calendar.locator('.fc-event').filter({ hasText: 'Design review' })
  ).toHaveCount(1);
  const initialScroll = await scroller.evaluate((el) => el.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(initialScroll + 100);
  await calendar.getByText('Hide recurring', { exact: true }).click();
  await expect(
    calendar.locator('.fc-event').filter({ hasText: 'Team check-in' })
  ).toHaveCount(1);
  await expect(page.locator('[data-focus-row]')).toHaveCount(5);
});
