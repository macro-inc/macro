import { expect, test } from '@playwright/test';

// Production controls and mutations with synthetic transport responses;
// these checks do not establish hosted persistence.
test('successful email additions retain keyboard focus in header and Record details', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard completion');
  for (const details of [false, true]) {
    for (const submit of ['Enter', 'Save']) {
      await page.goto('/?empty');
      if (details)
        await page
          .getByRole('button', { name: 'Show details', exact: true })
          .click();
      const trigger = page.getByRole('button', {
        name: 'Add email',
        exact: true,
      });
      const origin = details ? trigger.last() : trigger.first();
      await origin.focus();
      await page.keyboard.press('Enter');
      const input = page.getByRole('textbox', { name: 'Email', exact: true });
      await input.fill('focus@example.com');
      if (submit === 'Save')
        await page
          .getByRole('button', { name: 'Save', exact: true })
          .press('Enter');
      else await input.press('Enter');
      await expect(input).toBeHidden();
      await expect(
        page.getByText('focus@example.com', { exact: true }).first()
      ).toBeVisible();
      await expect(details ? trigger.last() : trigger.first()).toBeFocused();
    }
  }
});

test('email add validates, retains a rejected draft and lists the address after commit', async ({
  page,
}, info) => {
  const address = `contact@${'gmail.com'}`;
  await page.goto('/?empty');
  await page
    .getByRole('button', { name: 'Add email', exact: true })
    .first()
    .click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('invalid');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  await input.fill(address);
  await page.evaluate(() => {
    window.archiveFixture.holdNext();
    window.archiveFixture.failNext();
  });
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
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue(address);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('email-rejected.png'),
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(input).toBeHidden();
  await expect(
    page.getByRole('button', { name: `Email options for ${address}` }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true }).first()
  ).toBeVisible();
  const record = await page.evaluate(
    () => window.archiveFixture.snapshot().contacts[0]
  );
  expect(record.id).toBe('contact-1');
  expect(record.companyId).toBeNull();
  expect(record.hidden).toBe(false);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('email-added.png'),
  });
});

test('personal company link, switch and separate Go to', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?personal&unlinked');
  await page
    .getByRole('button', { name: 'Add company', exact: true })
    .first()
    .click();
  const search = page.getByPlaceholder('Search companies…');
  await expect(search).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'No company', exact: true })
  ).toHaveCount(0);
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
  const chip = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  await expect(chip).toContainText('Example company');
  await chip.click();
  await search.fill('Second');
  await page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Second company' })
    .click();
  if (isMobile)
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(search).toBeHidden();
  await expect(chip).toContainText('Second company');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-replaced.png'),
  });
  expect(
    await page.evaluate(() => window.archiveFixture.snapshot().contacts[0].id)
  ).toBe('contact-1');
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(2);
  await page
    .getByRole('button', { name: 'Go to company', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/opened=company-2/);
});

test('company picker exposes additional browse and search pages without saving', async ({
  page,
}, info) => {
  await page.goto('/?personal&unlinked&pagedCompanies');
  await page
    .getByRole('button', { name: 'Add company', exact: true })
    .first()
    .click();
  const search = page.getByPlaceholder('Search companies…');
  const company = (index: number) =>
    page
      .locator('[data-entity-index]')
      .filter({ hasText: `Company ${String(index).padStart(2, '0')}` });
  const next = page.getByRole('button', { name: 'Next options', exact: true });
  const loadNext = async () => {
    if (info.project.name === 'phone') await next.tap();
    else await search.press('PageDown');
  };

  await expect(company(0)).toBeVisible();
  await expect(company(50)).toHaveCount(0);
  await loadNext();
  await expect(company(50)).toBeVisible();
  await expect(next).toHaveCount(0);

  await search.fill('company');
  await expect(company(50)).toHaveCount(0);
  await expect(company(20)).toHaveCount(0);
  await loadNext();
  await expect(company(20)).toBeVisible();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
});

test('company picker exposes page loading, failure, and successful retry', async ({
  page,
}, info) => {
  await page.goto('/?personal&unlinked&pagedCompanies');
  await page
    .getByRole('button', { name: 'Add company', exact: true })
    .first()
    .click();
  const search = page.getByPlaceholder('Search companies…');
  const next = page.getByRole('button', { name: 'Next options', exact: true });
  const loadNext = async () => {
    if (info.project.name === 'phone') await next.tap();
    else await search.press('PageDown');
  };
  await page.evaluate(() => {
    window.companyPickerFixture.holdNext();
    window.companyPickerFixture.failNext();
  });
  await loadNext();
  await expect(
    page.getByRole('button', { name: 'Loading options…', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => window.companyPickerFixture.release());
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toBeVisible();
  await expect(next).toBeEnabled();
  await loadNext();
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Company 50' })
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toHaveCount(0);
  await expect(next).toHaveCount(0);
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
});

test('company-email and blank-email contacts stay read-only with company navigation', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Go to company', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Change contact company|Add company|Remove company/,
    })
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Go to company', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/opened=company-1/);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('read-only.png'),
  });
  await page.goto('/?empty');
  await expect(
    page.getByRole('button', { name: 'Add email', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true })
  ).toHaveCount(0);
});

test('company pending and rejection preserve draft for retry', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?personal');
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
  await page.goto('/?empty');
  await page
    .getByRole('button', { name: 'Add email', exact: true })
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
      page.getByRole('button', { name: 'Add email', exact: true }).first()
    ).toBeFocused();
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(page.getByText('Record details', { exact: true })).toBeVisible();
  const edits = page.getByRole('button', {
    name: 'Add email',
    exact: true,
  });
  await edits.last().click();
  await expect(input).toHaveValue('');
  await input.fill('details@example.com');
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(
    page.getByText('details@example.com', { exact: true }).last()
  ).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('record-details.png'),
  });
});

test('a pending response stays attached to its original contact after navigation', async ({
  page,
}) => {
  await page.goto('/?empty');
  await page
    .getByRole('button', { name: 'Add email', exact: true })
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
    .getByRole('button', { name: 'Add email', exact: true })
    .first();
  await expect(chip).toContainText('Add email');
  await page.evaluate(() => window.archiveFixture.release());
  await page.evaluate(() => window.archiveFixture.selectContact('contact-1'));
  await expect(
    page.getByText('edited@example.com', { exact: true }).first()
  ).toBeVisible();
  await page.evaluate(() => window.archiveFixture.selectContact('contact-2'));
  await expect(chip).toContainText('Add email');
});

test('company search keyboard selection and mobile header buttons keep their own Enter action', async ({
  page,
  isMobile,
}) => {
  await page.goto('/?personal');
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
    await page.goto('/?companyName=I&personal');
    const email = page
      .getByText(/^person1@/)
      .first()
      .locator('..');
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
    for (const control of [company, goTo]) {
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
    for (const control of [company]) {
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
    await expect(
      page.getByRole('textbox', { name: 'Company name' })
    ).toBeVisible();
    expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  }
});

test('several addresses: make primary, reject a duplicate, add, remove, and keep the company address', async ({
  page,
}, info) => {
  const personal = `person1@${'gmail.com'}`;
  await page.goto('/?several');
  const options = page.getByRole('button', { name: /^Email options for/ });
  await expect(options).toHaveText([
    'person1@example.com',
    personal,
    'person1.alt@example.org',
  ]);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('several-addresses.png'),
  });

  await options.nth(1).click();
  await page.evaluate(() => window.archiveFixture.holdNext());
  await page.getByRole('button', { name: 'Make primary', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Make primary', exact: true })
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBe('person1@example.com');
  await page.evaluate(() => window.archiveFixture.release());
  await expect(options).toHaveText([
    personal,
    'person1@example.com',
    'person1.alt@example.org',
  ]);

  // The one address on the company's domain links the contact to it.
  await options.nth(1).click();
  await expect(
    page.getByText('links the contact to its company')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove', exact: true })
  ).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-address.png'),
  });
  await page.keyboard.press('Escape');
  await expect(page.getByText('links the contact to its company')).toBeHidden();

  const add = page.getByRole('button', { name: 'Add email', exact: true });
  await add.first().click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('person2@example.com');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This email is already associated with another contact in this team.'
  );
  await expect(input).toHaveValue('person2@example.com');
  await input.fill('added@example.org');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(input).toBeHidden();
  await expect(options).toHaveCount(4);

  await options.nth(2).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(options).toHaveText([
    personal,
    'person1@example.com',
    'added@example.org',
  ]);
  const record = await page.evaluate(
    () => window.archiveFixture.snapshot().contacts[0]
  );
  expect(record.emails).toEqual([
    personal,
    'person1@example.com',
    'added@example.org',
  ]);
  expect(record.companyId).toBe('company-1');
  await expect(
    page.getByRole('button', {
      name: /Change contact company|Remove company/,
    })
  ).toHaveCount(0);
});

test('Remove company keeps a rejected relation and unlinks once the server commits', async ({
  page,
}, info) => {
  await page.goto('/?personal');
  await page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first()
    .click();
  const remove = page.getByRole('button', {
    name: 'Remove company',
    exact: true,
  });
  await page.evaluate(() => window.archiveFixture.failNext());
  await remove.click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].companyId
    )
  ).toBe('company-1');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('remove-company-rejected.png'),
  });
  await remove.click();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Go to company', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].companyId
    )
  ).toBeNull();
});

test('a server without the address list keeps addresses and company read-only', async ({
  page,
}) => {
  await page.goto('/?legacy&personal');
  await expect(page.getByText(/^person1@/).first()).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Email options for|Add email|Change contact company|Remove company/,
    })
  ).toHaveCount(0);

  // A blank contact can still add its first address there.
  await page.goto('/?legacy&empty');
  await page
    .getByRole('button', { name: 'Add email', exact: true })
    .first()
    .click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('first@example.org');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(input).toBeHidden();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBe('first@example.org');
  await expect(page.getByText('first@example.org').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Email options for|Add email/ })
  ).toHaveCount(0);
});
