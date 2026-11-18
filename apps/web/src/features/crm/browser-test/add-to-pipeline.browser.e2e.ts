import { expect, type Page, test } from '@playwright/test';

// A cold Vite server compiles the app's shared modules for the first page.
test.setTimeout(120_000);
// ADD_TO_PIPELINE_VIDEO=1 records each test for review.
test.use({ video: process.env.ADD_TO_PIPELINE_VIDEO ? 'on' : 'off' });

const DEVICES = [
  { name: 'desktop', width: 1280, height: 800, hasTouch: false },
  { name: 'phone', width: 390, height: 844, hasTouch: true },
] as const;

type Device = (typeof DEVICES)[number];

async function open(page: Page, query: string) {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route(/^http:\/\/localhost:\d+\//, async (route) => {
    await route.fulfill({ response: await route.fetch({ maxRetries: 2 }) });
  });
  await page.route('**/__macro_dev/**', (route) => route.abort());
  // Local container network changes can cancel Vite's initial module requests.
  // Retry only that startup failure, never an interaction.
  let networkChanged = false;
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED')
      networkChanged = true;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    networkChanged = false;
    await page.goto(
      `/src/features/crm/browser-test/add-to-pipeline.html?${query}`
    );
    await page.waitForLoadState('networkidle');
    if (!networkChanged) break;
  }
  const button = page.getByRole('button', { name: 'Add to pipeline' });
  await expect(button).toBeVisible({ timeout: 30_000 });
  return button;
}

const reads = (page: Page) => page.getByLabel('Reads');
const menu = (page: Page) =>
  page.getByRole('menu', { name: 'Add to pipeline' });
const cards = (page: Page) =>
  page.getByRole('region', { name: 'Pipelines' }).getByRole('article');

/** Opens a pipeline's stages: a submenu on desktop, in place on touch. */
async function openStages(page: Page, device: Device, pipeline: string) {
  const row = menu(page).getByRole('menuitem', { name: new RegExp(pipeline) });
  if (device.hasTouch) await row.tap();
  else await row.hover();
}

async function choose(page: Page, device: Device, name: string) {
  const item = page.getByRole('menuitem', { name, exact: true });
  if (device.hasTouch) await item.tap();
  else await item.click();
}

for (const device of DEVICES) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      hasTouch: device.hasTouch,
      isMobile: device.hasTouch,
    });

    test('a company page adds a deal at a stage and another to the same pipeline', async ({
      page,
    }) => {
      const button = await open(page, 'kind=company');
      if (device.name === 'phone')
        expect(await page.evaluate(() => innerWidth)).toBe(390);
      await expect(reads(page)).toHaveText('');
      await (device.hasTouch ? button.tap() : button.click());
      await expect(reads(page)).toHaveText('pipelines,entries');

      const list = menu(page);
      await expect(
        list.getByRole('menuitem', { name: /New business/ })
      ).toContainText('In Qualified');
      const referrals = list.getByRole('menuitem', {
        name: /Partner referrals/,
      });
      await expect(referrals).toHaveAttribute('aria-disabled', 'true');
      // Generic and contact pipelines are not offered on a company page.
      await expect(list.getByRole('menuitem')).toHaveCount(3);
      // Desktop explains a disabled row in a tooltip; touch shows it inline.
      if (!device.hasTouch) await referrals.hover();
      await page.screenshot({
        path: test.info().outputPath('company-menu.png'),
      });

      await openStages(page, device, 'Renewals');
      await expect(reads(page)).toContainText('schema:renewals');
      await expect(
        page.getByRole('menuitem', { name: 'Proposal', exact: true })
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath('company-stages.png'),
      });
      await choose(page, device, 'Lead');
      await expect(cards(page)).toHaveCount(2);
      await expect(page.getByText('Added to Renewals at Lead')).toBeVisible();

      // A company can have several deals in one pipeline.
      await (device.hasTouch ? button.tap() : button.click());
      await openStages(page, device, 'New business');
      await choose(page, device, 'Lead');
      await expect(cards(page)).toHaveCount(3);
      await expect(
        page.getByText('Added to New business at Lead')
      ).toBeVisible();
      // Reopening the menu reads nothing new.
      await expect(reads(page)).toHaveText(
        'pipelines,entries,schema:renewals,schema:new-business'
      );
      await page.screenshot({
        path: test.info().outputPath('company-added.png'),
      });
    });

    test('a stage that requires fields opens the add form for the record', async ({
      page,
    }) => {
      const button = await open(page, 'kind=company');
      await (device.hasTouch ? button.tap() : button.click());
      await openStages(page, device, 'Renewals');
      await choose(page, device, 'Proposal');

      const form = page.getByRole('dialog');
      await expect(form).toBeVisible();
      await expect(form).toContainText('Northwind Ceramics');
      await expect(
        form.getByRole('button', { name: 'Change company' })
      ).toHaveCount(0);
      // The record is fixed, so the form reads no company list.
      await expect(reads(page)).not.toContainText('companies');
      await expect(page.getByLabel('Pipeline writes')).toHaveText('0');
      await page.screenshot({
        path: test.info().outputPath('company-form.png'),
      });
      await form.getByRole('button', { name: /^Add/ }).click();
      // The stage's required amount is still missing.
      await expect(page.getByLabel('Pipeline writes')).toHaveText('0');
      await expect(form.getByRole('alert')).toContainText('Amount');
      const activate = device.hasTouch ? 'tap' : 'click';
      await form.getByRole('button', { name: /Amount/ })[activate]();
      const amount = form.getByRole('textbox', { name: 'Edit Amount' });
      await amount.fill('4800');
      await amount.press('Enter');
      await form.getByRole('button', { name: /^Add/ }).click();
      await expect(form).toBeHidden();
      await expect(cards(page)).toHaveCount(2);
      await expect(
        page.getByText('Added to Renewals at Proposal')
      ).toBeVisible();
    });

    test('a contact page refuses a pipeline the contact is already in', async ({
      page,
    }) => {
      const button = await open(page, 'kind=contact');
      await (device.hasTouch ? button.tap() : button.click());
      const list = menu(page);
      const hiringRow = list.getByRole('menuitem', { name: /Hiring/ });
      await expect(hiringRow).toContainText('In Lead');
      await expect(hiringRow).toHaveAttribute('aria-disabled', 'true');
      await expect(
        list.getByRole('menuitem', { name: /Event invites/ })
      ).toHaveAttribute('aria-disabled', 'true');
      await expect(list.getByRole('menuitem')).toHaveCount(3);
      if (!device.hasTouch) await hiringRow.hover();
      await page.screenshot({
        path: test.info().outputPath('contact-menu.png'),
      });
      await expect(hiringRow).toHaveAccessibleDescription(
        'This contact is already in this pipeline'
      );
      // A forced press on the disabled row does nothing.
      if (device.hasTouch) await hiringRow.tap({ force: true });
      else await hiringRow.click({ force: true });
      await expect(page.getByLabel('Pipeline writes')).toHaveText('0');
      await expect(
        page.getByRole('menuitem', { name: 'Lead', exact: true })
      ).toHaveCount(0);

      await openStages(page, device, 'Customer advisory board');
      await choose(page, device, 'Qualified');
      await expect(cards(page)).toHaveCount(2);
    });

    test('says so when the team has no pipelines for the record', async ({
      page,
    }) => {
      const button = await open(page, 'kind=contact&empty=true');
      await (device.hasTouch ? button.tap() : button.click());
      await expect(menu(page)).toContainText('No contact pipelines yet');
      await page.screenshot({
        path: test.info().outputPath('contact-empty.png'),
      });
    });

    test('a refused add says why and adds nothing', async ({ page }) => {
      const button = await open(page, 'kind=company');
      await page.evaluate(() =>
        (window as unknown as { failNextAdd(): void }).failNextAdd()
      );
      await (device.hasTouch ? button.tap() : button.click());
      await openStages(page, device, 'Renewals');
      await choose(page, device, 'Lead');
      await expect(
        page.getByText('The pipeline refused this row.')
      ).toBeVisible();
      await expect(cards(page)).toHaveCount(1);
    });
  });
}
