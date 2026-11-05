import { expect, test } from '@playwright/test';

// Production controls and mutations with synthetic transport responses;
// these checks do not establish hosted persistence.
test('email add, validation, pending, rejection, retry and clear', async ({
  page,
}, info) => {
  await page.goto('/?empty');
  await page
    .getByRole('button', { name: 'Add email', exact: true })
    .first()
    .click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(input).toBeVisible();
  await input.fill('first@example.com');
  await page.evaluate(() => window.archiveFixture.holdNext());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saving…', exact: true })
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBeNull();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('email-pending.png'),
  });
  await page.evaluate(() => window.archiveFixture.release());
  await expect(input).toBeHidden();
  const chip = page
    .getByRole('button', { name: 'Edit contact email', exact: true })
    .first();
  await expect(chip).toContainText('first@example.com');
  await chip.click();
  await input.fill('invalid');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(1);
  await input.fill('changed@example.com');
  await page.evaluate(() => window.archiveFixture.failNext());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('changed@example.com');
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBe('first@example.com');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('email-rejected.png'),
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(input).toBeHidden();
  await expect(chip).toContainText('changed@example.com');
  await chip.click();
  await page.getByRole('button', { name: 'Remove email', exact: true }).click();
  await expect(input).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Add email', exact: true }).first()
  ).toBeVisible();
  const record = await page.evaluate(
    () => window.archiveFixture.snapshot().contacts[0]
  );
  expect(record.id).toBe('contact-1');
  expect(record.companyId).toBeNull();
  expect(record.hidden).toBe(false);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('email-cleared.png'),
  });
});

test('company replace, clear, add and separate Go to', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/');
  const chip = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  await chip.click();
  const search = page.getByPlaceholder('Search companies…');
  await expect(search).toBeVisible();
  await search.fill('Second');
  await page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Second company' })
    .click();
  if (isMobile) {
    expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await expect(search).toBeHidden();
  await expect(chip).toContainText('Second company');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-replaced.png'),
  });
  await chip.click();
  await expect(search).toBeVisible();
  await page.getByRole('button', { name: 'No company', exact: true }).click();
  if (isMobile)
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(search).toBeHidden();
  const add = page
    .getByRole('button', { name: 'Add company', exact: true })
    .first();
  await expect(add).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Go to company', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.archiveFixture.snapshot().contacts[0].id)
  ).toBe('contact-1');
  await add.click();
  await expect(search).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-picker.png'),
  });
  await page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Example company' })
    .click();
  if (isMobile)
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(search).toBeHidden();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(3);
  await page
    .getByRole('button', { name: 'Go to company', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/opened=company-1/);
});

test('company pending and rejection preserve draft for retry', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first()
    .click();
  const search = page.getByPlaceholder('Search companies…');
  await expect(search).toBeVisible();
  await page.evaluate(() => {
    window.archiveFixture.holdNext();
    window.archiveFixture.failNext();
  });
  await search.fill('Second');
  await page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Second company' })
    .click();
  if (isMobile)
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saving' })
  ).toContainText('Saving');
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].companyId
    )
  ).toBe('company-1');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-pending.png'),
  });
  await page.evaluate(() => window.archiveFixture.release());
  await expect(page.getByRole('alert')).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-rejected.png'),
  });
  await page
    .getByRole('button', { name: isMobile ? 'Done' : 'Retry', exact: true })
    .click();
  await expect(search).toBeHidden();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].companyId
    )
  ).toBe('company-2');
});

test('keyboard cancel and Record details editing', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Edit contact email', exact: true })
    .first()
    .click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(input).toBeVisible();
  if (!isMobile) await expect(input).toBeFocused();
  await input.fill('discard@example.com');
  await input.press('Escape');
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  if (!isMobile)
    await expect(
      page
        .getByRole('button', { name: 'Edit contact email', exact: true })
        .first()
    ).toBeFocused();
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(page.getByText('Record details', { exact: true })).toBeVisible();
  const edits = page.getByRole('button', {
    name: 'Edit contact email',
    exact: true,
  });
  await edits.last().click();
  await expect(input).toHaveValue('person1@example.com');
  await input.fill('details@example.com');
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(edits.last()).toContainText('details@example.com');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('record-details.png'),
  });
});

test('a pending response stays attached to its original contact after navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Edit contact email', exact: true })
    .first()
    .click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('edited@example.com');
  await page.evaluate(() => window.archiveFixture.holdNext());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saving…', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => window.archiveFixture.selectContact('contact-2'));
  await expect(input).toBeHidden();
  const chip = page
    .getByRole('button', { name: 'Edit contact email', exact: true })
    .first();
  await expect(chip).toContainText('person2@example.com');
  await page.evaluate(() => window.archiveFixture.release());
  await page.evaluate(() => window.archiveFixture.selectContact('contact-1'));
  await expect(chip).toContainText('edited@example.com');
  await page.evaluate(() => window.archiveFixture.selectContact('contact-2'));
  await expect(chip).toContainText('person2@example.com');
});

test('company search keyboard selection and mobile header buttons keep their own Enter action', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const chip = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  await chip.click();
  const search = page.getByPlaceholder('Search companies…');
  await search.fill('Second');
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Example company' })
  ).toHaveCount(0);
  await search.press('Enter');
  if (isMobile) {
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.focus();
    await cancel.press('Enter');
    await expect(search).toBeHidden();
    expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
    await chip.click();
    await search.fill('Second');
    await expect(
      page.locator('[data-entity-index]').filter({ hasText: 'Example company' })
    ).toHaveCount(0);
    await search.press('Enter');
    const done = page.getByRole('button', { name: 'Done', exact: true });
    await done.focus();
    await done.press('Enter');
  }
  await expect(search).toBeHidden();
  await expect(chip).toContainText('Second company');
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(1);
});

test('property controls keep compact faces and distinct expanded touch targets', async ({
  page,
  isMobile,
}) => {
  for (const width of isMobile ? [320, 390, 820] : [1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?shortCompany');
    const email = page
      .getByRole('button', { name: 'Edit contact email', exact: true })
      .first();
    const company = page
      .getByRole('button', { name: 'Change contact company', exact: true })
      .first();
    const goTo = page
      .getByRole('button', { name: 'Go to company', exact: true })
      .first();
    for (const control of [email, company, goTo]) {
      await expect(control).toBeVisible();
      expect((await control.boundingBox())?.height).toBe(24);
      await expect(control).toHaveCSS('font-size', '12px');
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    if (!isMobile) continue;
    for (const control of [email, company, goTo]) {
      expect(
        await control.evaluate(
          (element) => getComputedStyle(element, '::before').height
        )
      ).toBe('44px');
      expect(
        await control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return [box.top - 9, box.bottom + 9].every(
            (y) =>
              document
                .elementFromPoint(box.x + box.width / 2, y)
                ?.closest('button') === element
          );
        })
      ).toBe(true);
    }
    for (const control of [email, company]) {
      expect((await control.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      expect(
        await control.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element, '::before').width)
        )
      ).toBeGreaterThanOrEqual(44);
    }
    expect(
      await goTo.evaluate(
        (element) => getComputedStyle(element, '::before').width
      )
    ).toBe('44px');
    const emailBox = (await email.boundingBox())!;
    await page.touchscreen.tap(emailBox.x + emailBox.width / 2, emailBox.y - 5);
    await expect(
      page.getByRole('textbox', { name: 'Email', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const companyBox = (await company.boundingBox())!;
    const goToBox = (await goTo.boundingBox())!;
    expect(goToBox.x - 10).toBeGreaterThanOrEqual(
      companyBox.x + companyBox.width
    );
    await page.touchscreen.tap(
      companyBox.x + companyBox.width / 2,
      companyBox.y - 5
    );
    await expect(page.getByPlaceholder('Search companies…')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByPlaceholder('Search companies…')).not.toBeAttached();
    await page.touchscreen.tap(goToBox.x + goToBox.width / 2, goToBox.y - 5);
    await expect(page).toHaveURL(/opened=company-1/);
    expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  }
});
