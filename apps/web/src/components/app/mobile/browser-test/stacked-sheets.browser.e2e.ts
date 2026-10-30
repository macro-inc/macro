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

/** A finger dragging the sheet down by its top edge, past the break point. */
async function dragDown(page: Page, sheet: Locator) {
  const box = await sheet.boundingBox();
  if (!box) throw new Error('The sheet is not rendered');
  const x = box.x + box.width / 2;
  const y = box.y + 12;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 10; step += 1)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (box.height * step) / 10 }],
    });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('a sheet its owner keeps open returns into view after a drag down', async ({
  page,
}) => {
  await page.goto('/?scenario=discard');
  const share = page.getByRole('dialog', { name: 'Share to Macro' });
  await settled(share);

  await dragDown(page, share);

  const confirm = page.getByRole('dialog', { name: 'Discard this share?' });
  await settled(confirm);
  await settled(share);
  await tap(page, confirm.getByRole('button', { name: 'Keep editing' }));
  await expect(confirm).toHaveCount(0);
  await tap(page, share.getByRole('button', { name: 'Send' }));
  await expect(pressed(page)).toHaveText('Send');

  await dragDown(page, share);
  await settled(confirm);
  await tap(page, confirm.getByRole('button', { name: 'Discard' }));
  await expect(share).toHaveCount(0);
});

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
