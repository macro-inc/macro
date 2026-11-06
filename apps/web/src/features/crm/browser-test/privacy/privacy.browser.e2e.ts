import { expect, test } from '@playwright/test';

const mailboxId = '00000000-0000-4000-8000-000000000045';
for (const admin of [false, true]) {
  test(`privacy controls and exact mailbox consent for ${admin ? 'admin' : 'member'}`, async ({
    page,
  }, testInfo) => {
    await page.goto(admin ? '/?admin' : '/');
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('member@example.com', { exact: true })
    ).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('privacy-review.png') });
    const removes = dialog.getByRole('button', { name: 'Remove', exact: true });
    if (admin) await expect(removes.nth(0)).toBeEnabled();
    else await expect(removes.nth(0)).toBeDisabled();
    await expect(removes.nth(1)).toBeEnabled();
    await removes.nth(1).click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'remove_domain',
        scope: 'personal',
        domain: 'personal.example.com',
      })
    );
    const input = dialog.getByRole('textbox', {
      name: 'Domain to block for the team',
    });
    await input.fill('new.example.com');
    await input
      .locator('..')
      .getByRole('button', { name: 'Add domain' })
      .click();
    await expect(
      dialog.getByText('new.example.com', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('privacy-controls.png'),
    });
    await dialog
      .getByRole('button', { name: 'Share my emails with CRM', exact: true })
      .click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'set_consent',
        enabled: true,
        link_id: mailboxId,
      })
    );
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole('button', { name: 'Email settings', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop sharing my emails', exact: true })
      .click();
    await expect(page.getByTestId('last-change')).toHaveText(
      JSON.stringify({
        action: 'set_consent',
        enabled: false,
        link_id: mailboxId,
      })
    );
    await page.screenshot({
      path: testInfo.outputPath('privacy-withdrawn.png'),
    });
  });
}
test('disconnected mailbox cannot opt in while exclusions remain editable', async ({
  page,
}) => {
  await page.goto('/?disconnected');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Share my emails with CRM', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('textbox', { name: 'Domain to block for my emails' })
  ).toBeEnabled();
});

test('banner opens review using the device input mode', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const review = page.getByRole('button', {
    name: 'Review and opt in',
    exact: true,
  });
  if (testInfo.project.name === 'phone') await review.tap();
  else await review.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('member@example.com', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
  await expect(
    dialog.getByRole('button', {
      name: 'Share my emails with CRM',
      exact: true,
    })
  ).toBeEnabled();
});
