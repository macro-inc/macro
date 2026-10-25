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

for (const [scenario, sheetName] of [
  ['event', 'Weekly product sync'],
  ['share', 'Share'],
]) {
  test(`a tap on the backdrop of ${sheetName} closes it without pressing the page`, async ({
    page,
  }) => {
    await page.goto(`/?scenario=${scenario}`);
    const sheet = page.getByRole('dialog', { name: sheetName });
    await settled(sheet);
    const pageControl = page.getByRole('button', {
      name: 'Page control',
      includeHidden: true,
    });

    await tap(page, pageControl);

    await expect(sheet).toHaveCount(0);
    await expect(pressed(page)).toHaveText('');

    await tap(page, pageControl);
    await expect(pressed(page)).toHaveText('Page control');
  });
}
