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
    const teamRemove = dialog.getByRole('button', {
      name: 'Remove team.example.com',
      exact: true,
    });
    const personalRemove = dialog.getByRole('button', {
      name: 'Remove personal.example.com',
      exact: true,
    });
    if (admin) await expect(teamRemove).toBeEnabled();
    else await expect(teamRemove).toBeDisabled();
    await expect(personalRemove).toBeEnabled();
    await personalRemove.click();
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
  const phone = testInfo.project.name === 'phone';
  if (phone) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  const review = page.getByRole('button', {
    name: 'Review and opt in',
    exact: true,
  });
  await expect(review).toBeInViewport();
  if (phone) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-touch-device',
      'true'
    );
    expect((await review.boundingBox())?.height).toBeGreaterThanOrEqual(36);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('privacy-banner.png') });
  if (phone) await review.tap();
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

test('owner can inspect and remove a private-thread exception', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  const remove = dialog.getByRole('button', {
    name: 'Remove exception for Private conversation',
    exact: true,
  });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeVisible();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText(/A teammate’s contributed copy can still be visible/)
  ).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-settings.png'),
  });
  await remove.click();
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000046',
      excluded: false,
    })
  );
  await expect(
    dialog.getByText('No threads on this page.', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-removed.png'),
  });
});

test('own thread action creates an exception using the device menu', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const trigger = page.getByRole('button', {
    name: 'Thread actions',
    exact: true,
  });
  if (testInfo.project.name === 'phone') await trigger.tap();
  else await trigger.click();
  const action = page.getByText('Keep this thread out of CRM', { exact: true });
  await expect(action).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath('thread-exclusion-menu.png'),
  });
  if (testInfo.project.name === 'phone') await action.tap();
  else await action.click();
  await expect(page.getByTestId('last-change')).toHaveText(
    JSON.stringify({
      action: 'set_thread_exclusion',
      thread_id: '00000000-0000-4000-8000-000000000049',
      excluded: true,
    })
  );
});

test('thread action is unavailable for a teammate copy', async ({
  page,
}, testInfo) => {
  await page.goto('/?teammate');
  await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .click();
  await expect(
    testInfo.project.name === 'phone'
      ? page.getByRole('dialog', { name: 'Thread actions', exact: true })
      : page.getByRole('menu')
  ).toBeVisible();
  await expect(
    page.getByText('Keep this thread out of CRM', { exact: true })
  ).toHaveCount(0);
});

test('owner can page through excluded threads and return to the first page', async ({
  page,
}) => {
  await page.goto('/?paged');
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(
    dialog.getByText('Another private conversation', { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Back to first page', exact: true })
    .click();
  await expect(
    dialog.getByText('Private conversation', { exact: true })
  ).toBeVisible();
});

test('disabled rollout keeps the thread action and exception settings unavailable', async ({
  page,
}) => {
  await page.goto('/?flag-off');
  await page
    .getByRole('button', { name: 'Thread actions', exact: true })
    .click();
  await expect(
    page.getByText('Keep this thread out of CRM', { exact: true })
  ).toHaveCount(0);
  await page.getByText('Copy link', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Email settings', exact: true })
    .click();
  await expect(
    page.getByText('Threads kept out of CRM', { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Domain to block for my emails' })
  ).toBeEnabled();
});
