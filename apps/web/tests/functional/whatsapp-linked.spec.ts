import assert from 'node:assert/strict';
import { expect, test } from './fixtures/meta-messaging';

test.use({
  baseURL: `http://127.0.0.1:${Number(process.env.FUNCTIONAL_APP_PORT ?? 4192)}`,
});
test('personal group uses the native timeline, own sender, scoped drafts and mobile participants', async ({
  page,
  context,
  messaging: f,
}, testInfo) => {
  test.setTimeout(180_000);
  f.state.linked = true;
  f.state.linkedConnected = true;
  await f.open(f.channels[1].id);
  await expect(f.input).toHaveAttribute(
    'placeholder',
    `Message ${f.channels[1].name}…`
  );
  await expect(page.getByText(/Send to WhatsApp ·/)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('linked-composer.png'),
    fullPage: true,
  });
  await expect(f.picker).toHaveCount(0);
  await f.expectNoCustomerCalls();
  await f.input.fill('Personal human reply');
  await f.sendButton.click();
  await expect(
    page
      .locator('[data-channel-message-list]')
      .getByText('Personal human reply', { exact: true })
  ).toHaveCount(1);
  assert.equal(f.submissions.length, 1);
  assert.ok(
    f.metaRequests.every((url) =>
      new URL(url).pathname.includes('/meta/linked/')
    )
  );
  f.state.linkedConnecting = true;
  await f.open(f.channels[1].id);
  await expect(
    page.getByText('Finishing the account connection.', { exact: false })
  ).toBeVisible();
  f.state.linkedConnecting = false;
  await f.open(f.channels[1].id);
  await f.input.fill('Draft for my first account');
  await f.open(f.channels[0].id);
  await f.open(f.channels[1].id);
  await expect(f.input).toHaveValue('Draft for my first account');
  f.state.linkedGeneration++;
  await f.open(f.channels[1].id);
  await expect(f.input).toHaveValue('');
  f.state.linkedOffline = true;
  await f.open(f.channels[1].id);
  await expect(
    page.getByText('WhatsApp is temporarily offline.', { exact: false })
  ).toBeVisible();
  await f.input.fill('Preserved while offline');
  await expect(f.sendButton).toBeDisabled();
  f.state.linkedOffline = false;
  await f.open(f.channels[1].id);
  await expect(f.input).toHaveValue('Preserved while offline');
  await page.getByText('Participants', { exact: true }).first().click();
  await expect(
    page.getByText('Macro access', { exact: true }).first()
  ).toBeInViewport();
  await expect(
    page.getByText('WhatsApp participants', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('External customer', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('linked-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  await f.open(f.channels[1].id);
  if (!(await f.input.isVisible())) {
    await page.getByText(f.channels[1].name, { exact: true }).first().click();
    await page.getByRole('radio', { name: 'Messages', exact: true }).click();
  }
  await expect(f.input).toHaveAttribute(
    'placeholder',
    `Message ${f.channels[1].name}…`
  );
  await expect(page.getByText(/Send to WhatsApp ·/)).toHaveCount(0);
  await expect(f.input).toHaveValue('Preserved while offline');
  await page.screenshot({
    path: testInfo.outputPath('linked-mobile.png'),
    fullPage: true,
  });
});

test('focused pairing keeps QR private and hands passkey authentication to desktop', async ({
  page,
  messaging: f,
}, testInfo) => {
  test.setTimeout(180_000);
  f.state.showSettings = true;
  await page.goto(`${f.origin}/app/settings/connections`);
  await expect(
    page.getByText('Connect your personal account to existing groups.', {
      exact: true,
    })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Connect your WhatsApp account'
  );
  await expect(page.locator('.ph-no-capture canvas')).toBeVisible();
  f.state.pairingState = 'passkey';
  const desktop = page.getByRole('link', {
    name: 'Finish connecting in Macro desktop',
  });
  await expect(desktop).toBeVisible();
  await expect(desktop).toHaveAttribute(
    'href',
    /^macro:\/\/app\?whatsappPairing=/
  );
  assert.ok(
    f.metaRequests.every((url) => !url.includes('controlled-local-qr-fixture'))
  );
  await page.screenshot({
    path: testInfo.outputPath('linked-pairing.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('Connect your WhatsApp account', { exact: true })
  ).toHaveCount(0);
});

test('adoption reviews an existing group and native audience without creating a remote group', async ({
  page,
  context,
  messaging: f,
}, testInfo) => {
  test.setTimeout(120_000);
  f.state.showSettings = true;
  f.state.linkedConnected = true;
  f.state.linked = true;
  await f.open(f.channels[0].id);
  await page
    .getByRole('button', { name: 'Create channel', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Connect WhatsApp group', exact: true })
    .click();
  await expect(
    page.getByText('Existing group of nine', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { name: 'Create a channel', exact: true })
  ).toHaveCount(0);
  const search = page.getByRole('textbox', { name: 'Search WhatsApp groups' });
  await expect(search).toBeFocused();
  await search.fill('no matching group');
  await expect(page.getByText('No groups match your search.')).toBeVisible();
  await search.fill('nine');
  await page.getByRole('button', { name: /Existing group of nine/ }).click();
  await expect(
    page.getByRole('button', { name: /Existing group of nine/ })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Macro access', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('linked-adoption.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true })
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  await page
    .getByRole('button', { name: 'Connect WhatsApp group', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Connect group', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: /Existing group of nine/ }).click();
  await expect(
    page.getByRole('button', { name: 'Connect group', exact: true })
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('linked-adoption-mobile.png'),
    fullPage: true,
  });
  let finishAdoption: (() => void) | undefined;
  const adoptionResponse = new Promise<void>((resolve) => {
    finishAdoption = resolve;
  });
  await page.route('**/dss/meta/linked/groups', async (route) => {
    if (route.request().method() === 'POST') await adoptionResponse;
    await route.fallback();
  });
  await page
    .getByRole('button', { name: 'Connect group', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Connecting…', exact: true })
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(search).toBeVisible();
  finishAdoption?.();
  await expect(f.input).toHaveAttribute(
    'placeholder',
    `Message ${f.channels[1].name}…`
  );
  await expect(page.getByText(/Send to WhatsApp ·/)).toHaveCount(0);
  assert.equal(f.state.groupCreateCalls, 0);
});
