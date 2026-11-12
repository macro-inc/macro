import { expect, type Page, test } from '@playwright/test';

async function changeTime(page: Page, kind: 'move' | 'resize') {
  const event = page.locator('.fc-timegrid-event').first();
  await event.scrollIntoViewIfNeeded();
  const before = await event.boundingBox();
  const ten = await page
    .locator('.fc-timegrid-slot[data-time="10:00:00"]')
    .first()
    .boundingBox();
  const eleven = await page
    .locator('.fc-timegrid-slot[data-time="11:00:00"]')
    .first()
    .boundingBox();
  if (!before || !ten || !eleven) throw new Error('Calendar did not lay out');
  const delta = eleven.y - ten.y;
  const x = before.x + before.width / 2;
  const y =
    kind === 'move'
      ? before.y + before.height / 2
      : before.y + before.height - 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 12 });
  await page.mouse.up();
  await expect(
    page.getByRole('dialog', { name: 'Save repeating event' })
  ).toBeVisible();
  return { event, before, delta };
}

test.describe('recurring grid changes', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'Pointer interactions use desktop Week and Day views'
  );
  test.use({ viewport: { width: 1280, height: 900 }, timezoneId: 'UTC' });

  test('keeps the actual time on multi-day events projected into the all-day row', async ({
    page,
  }) => {
    await page.goto('/time-change.html?projected=1');
    await expect(page.locator('.fc-daygrid-event').first()).toContainText(
      '10:00'
    );
    await expect(page.locator('.fc-daygrid-event').first()).not.toContainText(
      '00:00'
    );
  });
  for (const view of ['week', 'day']) {
    test(`${view}: retains a saved drop while occurrences refresh`, async ({
      page,
    }) => {
      await page.goto(`/time-change.html?view=${view}&deferRefresh=1`);
      const { event, before, delta } = await changeTime(page, 'move');
      await page.getByText('All events', { exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('request')).not.toBeEmpty();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.evaluate(() =>
        window.dispatchEvent(new Event('calendar-fixture-refresh'))
      );
      await expect(page.getByRole('main')).toHaveAttribute(
        'data-pending',
        'true'
      );
      expect((await event.boundingBox())?.y).toBeCloseTo(before.y + delta, 0);
      await expect(event).toContainText('12:00');
      await page.evaluate(() =>
        window.dispatchEvent(new Event('calendar-fixture-complete-refresh'))
      );
      await expect(page.getByRole('main')).toHaveAttribute(
        'data-pending',
        'false'
      );
      expect((await event.boundingBox())?.y).toBeCloseTo(before.y + delta, 0);
    });

    for (const kind of ['move', 'resize'] as const) {
      for (const scope of ['This event', 'All events', 'Cancel']) {
        test(`${view}: ${kind}, ${scope}`, async ({ page }) => {
          await page.goto(`/time-change.html?view=${view}`);
          const { event, before, delta } = await changeTime(page, kind);
          // A query refresh while choosing a scope must not undo the preview.
          await page.evaluate(() =>
            window.dispatchEvent(new Event('calendar-fixture-refresh'))
          );
          const dropped = await event.boundingBox();
          if (!dropped) throw new Error('Dropped event disappeared');
          if (kind === 'move')
            expect(dropped.y - before.y).toBeCloseTo(delta, 0);
          else expect(dropped.height - before.height).toBeCloseTo(delta, 0);
          await expect(event).toContainText('12:00');
          await expect(page.getByTestId('request')).toBeEmpty();
          if (view === 'week' && kind === 'move' && scope === 'All events') {
            await page.screenshot({
              path: '/tmp/recurring-drag-scope-dialog.png',
            });
          }
          if (scope === 'Cancel') {
            await page
              .getByRole('button', { name: 'Cancel', exact: true })
              .click();
            await expect(page.getByRole('dialog')).toHaveCount(0);
            const reverted = await event.boundingBox();
            expect(reverted?.y).toBeCloseTo(before.y, 0);
            expect(reverted?.height).toBeCloseTo(before.height, 0);
            await expect(page.getByTestId('request')).toBeEmpty();
            return;
          }
          await page.getByText(scope, { exact: true }).click();
          await page.getByRole('button', { name: 'Save', exact: true }).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          const text = await page.getByTestId('request').textContent();
          expect(JSON.parse(text ?? '{}')).toMatchObject({
            eventId: 'series',
            calendarId: 'calendar',
            scope: scope === 'This event' ? 'this_event' : 'all',
            patch: {
              time: {
                startsAt: `${scope === 'This event' ? '2026-11-09' : '2026-10-26'}T${kind === 'move' ? '11' : '10'}:00:00.000Z`,
                endsAt: `${scope === 'This event' ? '2026-11-09' : '2026-10-26'}T12:00:00.000Z`,
              },
            },
          });
        });
      }
    }
    test(`${view}: Escape cancels a move`, async ({ page }) => {
      await page.goto(`/time-change.html?view=${view}`);
      const { event, before } = await changeTime(page, 'move');
      await expect(
        page.getByRole('button', {
          name: 'Close Save repeating event',
          exact: true,
        })
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await event.boundingBox())?.y).toBeCloseTo(before.y, 0);
      await expect(page.getByTestId('request')).toBeEmpty();
    });
    test(`${view}: a refused save reverts a resize`, async ({ page }) => {
      await page.goto(`/time-change.html?view=${view}&failure=1`);
      const { event, before } = await changeTime(page, 'resize');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Fixture save failed');
      expect((await event.boundingBox())?.height).toBeCloseTo(before.height, 0);
    });
  }
});
