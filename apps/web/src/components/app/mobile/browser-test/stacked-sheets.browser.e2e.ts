import { expect, type Locator, type Page, test } from '@playwright/test';

async function tap(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('The tap target is not rendered');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Corvu starts the opening slide a frame after mount, so wait for it to end. */
async function settled(sheet: Locator) {
  await expect(sheet).toBeInViewport({ ratio: 1 });
  await expect(sheet).not.toHaveAttribute('data-transitioning');
}

const pressed = (page: Page) => page.getByRole('status', { name: 'Pressed' });

test('a pointerdown dismissal does not dismiss the parent on pointerup', async ({
  page,
}) => {
  await page.goto('/?scenario=event');
  const details = page.getByRole('dialog', { name: 'Weekly product sync' });
  await settled(details);
  await tap(page, details.getByRole('button', { name: 'Share note' }));
  const share = page.getByRole('dialog', { name: 'Share note' });
  await settled(share);

  await tap(
    page,
    page.getByRole('button', { name: 'Page control', includeHidden: true })
  );

  await expect(share).toHaveCount(0);
  await expect(details).toBeVisible();
  await expect(pressed(page)).toHaveText('');
  await tap(page, details.getByRole('button', { name: 'Edit' }));
  await expect(pressed(page)).toHaveText('Edit');
  await tap(
    page,
    page.getByRole('button', { name: 'Page control', includeHidden: true })
  );
  await expect(details).toHaveCount(0);
  await expect(pressed(page)).toHaveText('Edit');
});

for (const control of ['Remove', 'Back to settings']) {
  test(`a tap on the dimmed Settings sheet over ${control} closes only Connect email`, async ({
    page,
  }) => {
    await page.goto('/?scenario=settings');
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settled(settings);
    await tap(page, page.getByRole('button', { name: 'Add account' }));
    const connectEmail = page.getByRole('dialog', { name: 'Connect email' });
    await settled(connectEmail);

    const covered = settings.getByRole('button', {
      name: control,
      exact: true,
    });
    await tap(page, covered);

    await expect(connectEmail).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole('heading', { name: 'Email' })
    ).toBeVisible();
    await expect(pressed(page)).toHaveText('');

    await tap(page, covered);
    await expect(pressed(page)).not.toHaveText('');
  });
}

for (const [opener, sheetName] of [
  ['Add guests', 'Add guests'],
  ['RSVP', 'RSVP to recurring event'],
  ['Delete', 'Delete event'],
]) {
  test(`a tap on the dimmed event details closes only ${sheetName}`, async ({
    page,
  }) => {
    await page.goto('/?scenario=event');
    const details = page.getByRole('dialog', { name: 'Weekly product sync' });
    await settled(details);
    await tap(page, details.getByRole('button', { name: opener }));
    const sheet = page.getByRole('dialog', { name: sheetName });
    await settled(sheet);

    const edit = details.getByRole('button', { name: 'Edit' });
    await tap(page, edit);

    await expect(sheet).toHaveCount(0);
    await expect(details).toBeVisible();
    await expect(pressed(page)).toHaveText('');

    await tap(page, edit);
    await expect(pressed(page)).toHaveText('Edit');
  });
}

for (const [opener, sheetName, control, result] of [
  ['Add guests', 'Add guests', 'Add Priya', 'Add guest'],
  ['RSVP', 'RSVP to recurring event', 'All events', 'All events'],
  ['Delete', 'Delete event', 'Delete', 'Confirm delete'],
]) {
  test(`a tap on ${control} in ${sheetName} over event details presses it`, async ({
    page,
  }) => {
    await page.goto('/?scenario=event');
    const details = page.getByRole('dialog', { name: 'Weekly product sync' });
    await settled(details);
    await tap(page, details.getByRole('button', { name: opener }));
    const sheet = page.getByRole('dialog', { name: sheetName });
    await settled(sheet);

    await tap(page, sheet.getByRole('button', { name: control, exact: true }));

    await expect(pressed(page)).toHaveText(result);
    await expect(details).toBeVisible();
  });
}

test('a tap on Gmail in Connect email over Settings presses it', async ({
  page,
}) => {
  await page.goto('/?scenario=settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settled(settings);
  await tap(page, page.getByRole('button', { name: 'Add account' }));
  const connectEmail = page.getByRole('dialog', { name: 'Connect email' });
  await settled(connectEmail);

  await tap(page, connectEmail.getByRole('button', { name: 'Gmail' }));

  await expect(pressed(page)).toHaveText('Connect GMAIL');
  await expect(connectEmail).toHaveCount(0);
  await expect(settings).toBeVisible();
});

test('a tap on the backdrop of event details closes it without pressing the page', async ({
  page,
}) => {
  await page.goto('/?scenario=event');
  const details = page.getByRole('dialog', { name: 'Weekly product sync' });
  await settled(details);
  const pageControl = page.getByRole('button', {
    name: 'Page control',
    includeHidden: true,
  });

  await tap(page, pageControl);

  await expect(details).toHaveCount(0);
  await expect(pressed(page)).toHaveText('');

  await tap(page, pageControl);
  await expect(pressed(page)).toHaveText('Page control');
});
