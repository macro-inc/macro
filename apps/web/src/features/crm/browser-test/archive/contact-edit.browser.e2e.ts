import { expect, type Locator, type Page, test } from '@playwright/test';

// Production controls and mutations with synthetic transport responses;
// these checks do not establish hosted persistence.
/** Whether a row action takes room, as it does only while shown. */
const shown = (action: Locator) =>
  action.evaluate(
    (element) => (element.parentElement?.getBoundingClientRect().width ?? 0) > 0
  );

/** The header's Email pill, named for its primary address. */
const emailPill = (page: Page) =>
  page
    .locator('[aria-label="Contact details"]')
    .getByRole('button', { name: /^(Email:|Add email$)/ });

/**
 * A row action in the email editor or Record details. On desktop a row shows
 * its actions while the pointer is on it, so the pointer goes there first.
 */
async function rowAction(scope: Locator, name: string, isMobile: boolean) {
  const action = scope.getByRole('button', { name, exact: true });
  if (!isMobile)
    await action
      .locator('xpath=ancestor::*[contains(@class, "group/address")][1]')
      .hover();
  return action;
}

test('email additions keep the editor open for the next address and focus returns to its control', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard completion');
  for (const details of [false, true]) {
    for (const submit of ['Enter', 'Add']) {
      await page.goto('/?empty');
      if (details)
        await page
          .getByRole('button', { name: 'Show details', exact: true })
          .click();
      const origin = details
        ? page.getByRole('button', { name: 'Add email', exact: true }).last()
        : emailPill(page);
      await origin.focus();
      await page.keyboard.press('Enter');
      const input = page.getByRole('textbox', { name: 'Email', exact: true });
      await expect(input).toBeFocused();
      await input.fill('focus@example.com');
      if (submit === 'Add')
        await page.getByRole('button', { name: 'Add', exact: true }).click();
      else await input.press('Enter');
      await expect(page.getByRole('list', { name: 'Email' })).toContainText(
        'focus@example.com'
      );
      await expect(input).toHaveValue('');
      await expect(input).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(input).toBeHidden();
      await expect(origin).toBeFocused();
    }
  }
});

test('email add validates, retains a rejected draft and lists the address after commit', async ({
  page,
}, info) => {
  const address = 'contact@example.net';
  await page.goto('/?empty');
  await emailPill(page).click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('invalid');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  await input.fill(address);
  await page.evaluate(() => {
    window.archiveFixture.holdNext();
    window.archiveFixture.failNext();
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
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
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('list', { name: 'Email' })).toContainText(
    address
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: `Email: ${address}`, exact: true })
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

test('personal company link, switch, and open from the company pill', async ({
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
  await expect(
    page.getByRole('button', { name: 'Open Example company', exact: true })
  ).toHaveCount(1);
  const caret = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  await caret.click();
  await search.fill('Second');
  await page
    .locator('[data-entity-index]')
    .filter({ hasText: 'Second company' })
    .click();
  if (isMobile)
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(search).toBeHidden();
  const name = page
    .getByRole('button', { name: 'Open Second company', exact: true })
    .first();
  await expect(name).toContainText('Second company');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-replaced.png'),
  });
  expect(
    await page.evaluate(() => window.archiveFixture.snapshot().contacts[0].id)
  ).toBe('contact-1');
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(2);
  await name.click();
  await expect(page).toHaveURL(/opened=company-2/);
});

test('company picker lists further browse and search pages as it scrolls, without saving', async ({
  page,
}) => {
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
  const scrollToEnd = () =>
    page.locator('[data-entity-index]').last().scrollIntoViewIfNeeded();

  await expect(company(0)).toBeVisible();
  await expect(company(50)).toHaveCount(0);
  await scrollToEnd();
  await company(50).scrollIntoViewIfNeeded();
  await expect(company(50)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Next options', exact: true })
  ).toHaveCount(0);

  await search.fill('company');
  await expect(company(50)).toHaveCount(0);
  await expect(company(20)).toHaveCount(0);
  await scrollToEnd();
  await company(20).scrollIntoViewIfNeeded();
  await expect(company(20)).toBeVisible();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
});

test('company picker shows page loading, failure, and successful retry', async ({
  page,
}) => {
  await page.goto('/?personal&unlinked&pagedCompanies');
  await page
    .getByRole('button', { name: 'Add company', exact: true })
    .first()
    .click();
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Company 00' })
  ).toBeVisible();
  await page.evaluate(() => {
    window.companyPickerFixture.holdNext();
    window.companyPickerFixture.failNext();
  });
  await page.locator('[data-entity-index]').last().scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading options…' })
  ).toBeVisible();
  await page.evaluate(() => window.companyPickerFixture.release());
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toBeVisible();
  // A failed page waits for Retry rather than reading again by itself.
  const retry = page.getByRole('button', { name: 'Retry options' });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.locator('[data-entity-index]').filter({ hasText: 'Company 50' })
  ).toHaveCount(1);
  await expect(
    page.getByRole('status').filter({ hasText: 'Options unavailable' })
  ).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
});

test('a company set by the email domain stays read-only and opens from its name', async ({
  page,
}, info) => {
  await page.goto('/');
  const name = page
    .getByRole('button', { name: 'Open Example company', exact: true })
    .first();
  await expect(name).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Change contact company|Add company|Remove company/,
    })
  ).toHaveCount(0);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('read-only.png'),
  });
  await name.click();
  await expect(page).toHaveURL(/opened=company-1/);
  // A blank contact has no company, and can link one.
  await page.goto('/?empty');
  await expect(emailPill(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true }).first()
  ).toBeVisible();
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
  await emailPill(page).click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(input).toBeVisible();
  if (!isMobile) await expect(input).toBeFocused();
  await input.fill('discard@example.com');
  await input.press('Escape');
  await expect(input).toBeHidden();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  if (!isMobile) await expect(emailPill(page)).toBeFocused();
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(page.getByText('Record details', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Add email', exact: true })
    .last()
    .click();
  await expect(input).toHaveValue('');
  await input.fill('details@example.com');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(
    page
      .getByRole('group', { name: 'Email', exact: true })
      .getByText('details@example.com', { exact: true })
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
  await emailPill(page).click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('edited@example.com');
  await page.evaluate(() => window.archiveFixture.holdNext());
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Saving…', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => window.archiveFixture.selectContact('contact-2'));
  await expect(input).toBeHidden();
  const pill = emailPill(page);
  await expect(pill).toHaveAccessibleName('Add email');
  await page.evaluate(() => window.archiveFixture.release());
  await page.evaluate(() => window.archiveFixture.selectContact('contact-1'));
  await expect(pill).toHaveAccessibleName('Email: edited@example.com');
  await page.evaluate(() => window.archiveFixture.selectContact('contact-2'));
  await expect(pill).toHaveAccessibleName('Add email');
});

test('company search keyboard selection and mobile header buttons keep their own Enter action', async ({
  page,
  isMobile,
}) => {
  await page.goto('/?personal');
  const caret = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  await caret.click();
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
    await caret.click();
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
  await expect(
    page.getByRole('button', { name: 'Open Second company', exact: true })
  ).toHaveCount(1);
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(1);
});

test('property controls keep compact faces and distinct expanded touch targets', async ({
  page,
  isMobile,
}) => {
  for (const width of isMobile ? [320, 390, 820] : [1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?companyName=I&personal');
    const email = emailPill(page);
    const name = page
      .getByRole('button', { name: 'Open I', exact: true })
      .first();
    const caret = page
      .getByRole('button', { name: 'Change contact company', exact: true })
      .first();
    for (const control of [email, name, caret]) {
      await expect(control).toBeVisible();
      await expect(control).toHaveCSS('font-size', '12px');
    }
    expect((await email.boundingBox())?.height).toBe(24);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    const nameBox = (await name.boundingBox())!;
    const caretBox = (await caret.boundingBox())!;
    // The caret is the company pill's second segment, right after the name.
    expect(caretBox.y).toBe(nameBox.y);
    expect(caretBox.x - (nameBox.x + nameBox.width)).toBeLessThanOrEqual(2);
    if (!isMobile) {
      expect(nameBox.height).toBe(24);
      expect(caretBox.height).toBe(24);
      continue;
    }
    // The email pill keeps a 24px face with a separate 44px target.
    expect(
      await email.evaluate(
        (element) => getComputedStyle(element, '::before').height
      )
    ).toBe('44px');
    expect(
      await email.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [box.top - 9, box.bottom + 9].every(
          (y) =>
            document
              .elementFromPoint(box.x + box.width / 2, y)
              ?.closest('button') === element
        );
      })
    ).toBe(true);
    // A button group clips its segments, so on touch they take its own 36px
    // height, as a task's Project pill does; a short name still gets 44px.
    expect(nameBox.height).toBeGreaterThanOrEqual(36);
    expect(caretBox.height).toBeGreaterThanOrEqual(36);
    expect(nameBox.width).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(
      caretBox.x + caretBox.width / 2,
      caretBox.y + caretBox.height / 2
    );
    await expect(page.getByPlaceholder('Search companies…')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByPlaceholder('Search companies…')).not.toBeAttached();
    await page.touchscreen.tap(
      nameBox.x + nameBox.width / 2,
      nameBox.y + nameBox.height / 2
    );
    await expect(page).toHaveURL(/opened=company-1/);
    await expect(
      page.getByRole('textbox', { name: 'Company name' })
    ).toBeVisible();
    expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);
  }
});
test('several addresses: make primary, reject a duplicate, add, remove, and keep the company address', async ({
  page,
  isMobile,
}, info) => {
  const personal = 'person1@example.net';
  await page.goto('/?several');
  await expect(emailPill(page)).toHaveAccessibleName(
    'Email: person1@example.com and 2 more'
  );
  await emailPill(page).click();
  const list = page.getByRole('list', { name: 'Email' });
  const rows = list.getByRole('listitem');
  const addresses = list.locator('.ph-no-capture');
  await expect(addresses).toHaveText([
    'person1@example.com',
    personal,
    'person1.alt@example.org',
  ]);
  await expect(rows.first()).toContainText('Primary');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('several-addresses.png'),
  });

  await page.evaluate(() => window.archiveFixture.holdNext());
  const makePrimary = await rowAction(
    list,
    `Make ${personal} primary`,
    isMobile
  );
  await makePrimary.click();
  await expect(makePrimary).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBe('person1@example.com');
  await page.evaluate(() => window.archiveFixture.release());
  await expect(addresses).toHaveText([
    personal,
    'person1@example.com',
    'person1.alt@example.org',
  ]);
  await expect(rows.first()).toContainText('Primary');

  // The one address on the company's domain links the contact to it: it has
  // no Remove, and nothing says so.
  await expect(
    list.getByRole('button', { name: 'Remove person1@example.com' })
  ).toHaveCount(0);
  await expect(page.getByText('links the contact to its company')).toHaveCount(
    0
  );
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('company-address.png'),
  });

  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('person2@example.com');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This email is already associated with another contact in this team.'
  );
  await expect(input).toHaveValue('person2@example.com');
  await input.fill('added@example.org');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await expect(input).toHaveValue('');

  await (
    await rowAction(list, 'Remove person1.alt@example.org', isMobile)
  ).click();
  await expect(addresses).toHaveText([
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

test('Record details shows every address in full beside Primary, actions only where the row can take them, and Add email below', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?several&long&independent');
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(page.getByText('Record details', { exact: true })).toBeVisible();
  const field = page.getByRole('group', { name: 'Email', exact: true });
  const addresses = field.getByRole('button', { name: /^Email options for/ });
  await expect(addresses).toHaveText([
    'person1@example.org',
    'person1@example.net',
    'person1.with.a.much.longer.mailbox.name@example.org',
  ]);
  const primary = addresses.first();
  // The primary is short enough to show in full beside its badge.
  expect(
    await primary
      .locator('span')
      .last()
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  const add = field.getByRole('button', { name: 'Add email', exact: true });
  await expect(add).toBeVisible();
  // Measured in one frame: on touch Record details is a sheet still moving in.
  const box = await field.evaluate((group) => {
    const rect = (element: Element | null | undefined) => {
      const { x, y, width, height } = element!.getBoundingClientRect();
      return { x, y, width, height, middle: y + height / 2 };
    };
    const addresses = [
      ...group.querySelectorAll('button[aria-label^="Email options for"]'),
    ];
    const labelElement = group.parentElement?.previousElementSibling;
    const label = rect(labelElement);
    const inset = Number.parseFloat(getComputedStyle(labelElement!).paddingTop);
    return {
      // The label's text, below its top padding.
      label: { ...label, middle: label.y + inset + (label.height - inset) / 2 },
      primary: rect(addresses[0]),
      last: rect(addresses.at(-1)),
      badge: rect(
        [...group.querySelectorAll('[data-slot="badge"]')].find(
          (badge) => badge.textContent === 'Primary'
        )
      ),
      add: rect(group.querySelector('button[aria-label="Add email"]')),
    };
  });
  expect(Math.abs(box.primary.middle - box.badge.middle)).toBeLessThanOrEqual(
    1
  );
  expect(box.badge.x).toBeGreaterThanOrEqual(box.primary.x + box.primary.width);

  // The Email label sits on the first address's line.
  await expect(field.locator('xpath=../preceding-sibling::span[1]')).toHaveText(
    'Email'
  );
  expect(Math.abs(box.label.middle - box.primary.middle)).toBeLessThanOrEqual(
    2
  );

  // Add email is the side panel's add pill, under the last address, on the
  // addresses' edge.
  expect(box.add.y).toBeGreaterThan(box.last.y + box.last.height - 1);
  expect(Math.abs(box.add.x - box.primary.x)).toBeLessThanOrEqual(2);
  await expect(add).toContainText('Add email');

  // A row shows only the actions it can take: the primary has no Make
  // primary. On desktop they show while the row is hovered; on touch, always.
  const remove = field.getByRole('button', {
    name: 'Remove person1@example.net',
  });
  const makePrimary = field.getByRole('button', {
    name: 'Make person1@example.net primary',
  });
  await expect(
    field.getByRole('button', { name: 'Make person1@example.org primary' })
  ).toHaveCount(0);
  if (isMobile) {
    expect(await shown(remove)).toBe(true);
    expect(await shown(makePrimary)).toBe(true);
  } else {
    expect(await shown(remove)).toBe(false);
    expect(await shown(makePrimary)).toBe(false);
    await addresses.nth(1).hover();
    await expect.poll(() => shown(remove)).toBe(true);
    expect(await shown(makePrimary)).toBe(true);
    // The other rows keep theirs out of the way.
    expect(
      await shown(
        field.getByRole('button', { name: 'Remove person1@example.org' })
      )
    ).toBe(false);
  }
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('record-details-rows.png'),
  });

  // The address that links the company has no Remove at all.
  await page.goto('/?several');
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const linked = page.getByRole('group', { name: 'Email', exact: true });
  await expect(
    linked.getByRole('button', { name: /^Email options for/ })
  ).toHaveCount(3);
  await expect(
    linked.getByRole('button', { name: 'Remove person1@example.com' })
  ).toHaveCount(0);
  await expect(
    linked.getByRole('button', { name: 'Remove person1@example.net' })
  ).toHaveCount(1);
});

test('a company header shows its domains as one pill', async ({ page }) => {
  await page.goto('/?kind=company&twoDomains');
  const details = page.getByLabel('Company details');
  await expect(details).toContainText('example.com');
  await expect(details).toContainText('+1');
  await expect(details).not.toContainText('example.org');
});

test('keyboard: Record details row actions, then the editor, return focus where the page left it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop keyboard focus');
  await page.goto('/?several&long&independent');
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const field = page.getByRole('group', { name: 'Email', exact: true });
  const address = (email: string) =>
    field.getByRole('button', { name: `Email options for ${email}` });
  const add = field.getByRole('button', { name: 'Add email', exact: true });

  // Tab reaches each action, which shows as it takes focus.
  await address('person1@example.net').focus();
  await page.keyboard.press('Tab');
  const remove = field.getByRole('button', {
    name: 'Remove person1@example.net',
  });
  await expect(remove).toBeFocused();
  expect(await shown(remove)).toBe(true);
  await page.keyboard.press('Tab');
  const makePrimary = field.getByRole('button', {
    name: 'Make person1@example.net primary',
  });
  await expect(makePrimary).toBeFocused();
  expect(await shown(makePrimary)).toBe(true);
  expect(
    await makePrimary.evaluate((element) => getComputedStyle(element).boxShadow)
  ).toContain('0px 0px 0px 2px');

  // Made primary, the address moves first and keeps focus.
  await page.keyboard.press('Enter');
  await expect(
    field.getByRole('button', { name: /^Email options for/ }).first()
  ).toHaveText('person1@example.net');
  await expect(address('person1@example.net')).toBeFocused();

  // Removed, its row leaves and focus goes to Add email.
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(address('person1@example.net')).toHaveCount(0);
  await expect(add).toBeFocused();

  // Add email opens the editor on its field; Escape comes back.
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await expect(add).toBeFocused();

  // An address opens the editor too, and focus returns to the address.
  await address('person1@example.org').focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(address('person1@example.org')).toBeFocused();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(2);
});

test('Remove company confirms, keeps a rejected relation and unlinks once the server commits', async ({
  page,
}, info) => {
  await page.goto('/?personal');
  const chip = page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first();
  const remove = page.getByRole('button', {
    name: 'Remove company',
    exact: true,
  });
  const dialog = page.getByRole('dialog').filter({
    hasText: 'Remove company from this contact?',
  });
  const companyId = () =>
    page.evaluate(() => window.archiveFixture.snapshot().contacts[0].companyId);

  // Cancelling writes nothing.
  await chip.click();
  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText('cannot be linked');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.archiveFixture.writes())).toBe(0);

  await chip.click();
  await remove.click();
  await page.evaluate(() => {
    window.archiveFixture.holdNext();
    window.archiveFixture.failNext();
  });
  await dialog.getByRole('button', { name: 'Remove company' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Remove company' })
  ).toBeDisabled();
  expect(await companyId()).toBe('company-1');
  await page.evaluate(() => window.archiveFixture.release());
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await companyId()).toBe('company-1');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('remove-company-rejected.png'),
  });
  await dialog.getByRole('button', { name: 'Remove company' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Example company', exact: true })
  ).toHaveCount(0);
  expect(await companyId()).toBeNull();
});

test('an independent contact confirms Remove company and can link one again', async ({
  page,
}, info) => {
  await page.goto('/?independent');
  await page
    .getByRole('button', { name: 'Change contact company', exact: true })
    .first()
    .click();
  // Only a personal address switches companies; this one can only remove it.
  await expect(page.getByPlaceholder('Search companies…')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Remove company', exact: true })
    .click();
  const dialog = page.getByRole('dialog').filter({
    hasText: 'Remove company from this contact?',
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('remove-company-independent.png'),
  });
  await dialog.getByRole('button', { name: 'Remove company' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Add company', exact: true }).first()
  ).toBeVisible();
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
      name: /^Email|Add email|Change contact company|Remove company/,
    })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const field = page.getByRole('group', { name: 'Email', exact: true });
  await expect(field).toContainText('person1@example.net');
  await expect(field.getByRole('button')).toHaveCount(0);

  // A blank contact can still add its first address there; the editor then
  // closes, having nothing more to offer.
  await page.goto('/?legacy&empty');
  await emailPill(page).click();
  const input = page.getByRole('textbox', { name: 'Email', exact: true });
  await input.fill('first@example.org');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(input).toBeHidden();
  expect(
    await page.evaluate(
      () => window.archiveFixture.snapshot().contacts[0].email
    )
  ).toBe('first@example.org');
  await expect(page.getByText('first@example.org').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Email|Add email/ })
  ).toHaveCount(0);
});
